'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT         = process.env.DASHBOARD_PORT ? parseInt(process.env.DASHBOARD_PORT, 10) : 4747;
const HOST         = process.env.DASHBOARD_HOST ?? '0.0.0.0';
const REPO_ROOT    = path.resolve(__dirname, '..');
const QUEUE_DIR    = path.join(REPO_ROOT, 'bridge', 'queue');
const HEARTBEAT    = path.join(REPO_ROOT, 'bridge', 'heartbeat.json');
const REGISTER     = path.join(REPO_ROOT, 'bridge', 'register.jsonl');
const STAGED_DIR   = path.join(REPO_ROOT, 'bridge', 'staged');
const TRASH_DIR    = path.join(REPO_ROOT, 'bridge', 'trash');
const DASHBOARD    = path.join(__dirname, 'lcars-dashboard.html');
const TOKENS_CSS   = path.join(__dirname, 'tokens.css');
const BRANCH_STATE = path.join(REPO_ROOT, 'bridge', 'state', 'branch-state.json');

const FIRST_OUTPUT  = path.join(REPO_ROOT, 'bridge', 'first-output.json');
const NOG_ACTIVE    = path.join(REPO_ROOT, 'bridge', 'nog-active.json');
const CONTROL_DIR   = path.join(REPO_ROOT, 'bridge', 'control');
const SESSIONS      = path.join(REPO_ROOT, 'bridge', 'sessions.jsonl');
const { translateEvent, resetDedupeState } = require(path.join(REPO_ROOT, 'bridge', 'lifecycle-translate'));

const CORS_ORIGIN  = 'https://dax-dashboard.lovable.app';

// Hide DONE slices older than this many days from the Queue panel.
// Pre-lifecycle stragglers sit in DONE forever; this keeps them out of sight.
const STALE_DONE_DAYS = 7;

// ── Mtime-based in-memory cache ─────────────────────────────────────────────
// Eliminates per-request re-parse of large files (register.jsonl is 27MB+).
// Each cache entry stores { mtimeMs, value }. On read, stat the file; if mtime
// is unchanged, return cached value. Otherwise re-parse and update cache.
const _cache = {};

/**
 * getCachedFile(filePath, parser)
 *
 * Returns the cached parsed result if the file's mtime hasn't changed.
 * `parser` receives the raw file content (utf-8 string) and returns the parsed value.
 * Returns null if the file doesn't exist or can't be read.
 */
function getCachedFile(filePath, parser) {
  try {
    const stat = fs.statSync(filePath);
    const entry = _cache[filePath];
    if (entry && entry.mtimeMs === stat.mtimeMs) {
      return entry.value;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const value = parser(raw);
    _cache[filePath] = { mtimeMs: stat.mtimeMs, value };
    return value;
  } catch (_) {
    return null;
  }
}

/**
 * getCachedDir(dirPath, fileParser)
 *
 * Caches a directory listing + per-file parsed content using mtime checks.
 * The directory's own mtime invalidates the file list. Per-file mtimes
 * invalidate individual parsed entries. Returns { files, parsed }.
 * `fileParser(filePath, content)` returns parsed value per file (or null to skip).
 */
function getCachedDir(dirPath, fileFilter, fileParser) {
  let dirEntry = _cache['dir:' + dirPath];
  let dirMtimeMs;
  try {
    dirMtimeMs = fs.statSync(dirPath).mtimeMs;
  } catch (_) {
    return { files: [], parsed: {} };
  }

  // If dir mtime changed, re-read file list
  if (!dirEntry || dirEntry.dirMtimeMs !== dirMtimeMs) {
    let allFiles;
    try { allFiles = fs.readdirSync(dirPath).filter(fileFilter); }
    catch (_) { allFiles = []; }
    dirEntry = { dirMtimeMs, files: allFiles, perFile: dirEntry ? dirEntry.perFile : {} };
    _cache['dir:' + dirPath] = dirEntry;
  }

  // Check per-file mtimes
  const parsed = {};
  for (const file of dirEntry.files) {
    const filePath = path.join(dirPath, file);
    try {
      const fstat = fs.statSync(filePath);
      const existing = dirEntry.perFile[file];
      if (existing && existing.mtimeMs === fstat.mtimeMs) {
        parsed[file] = existing.value;
      } else {
        const raw = fs.readFileSync(filePath, 'utf8');
        const value = fileParser(filePath, raw);
        dirEntry.perFile[file] = { mtimeMs: fstat.mtimeMs, value };
        parsed[file] = value;
      }
    } catch (_) {}
  }

  // Prune stale per-file entries
  const fileSet = new Set(dirEntry.files);
  for (const k of Object.keys(dirEntry.perFile)) {
    if (!fileSet.has(k)) delete dirEntry.perFile[k];
  }

  return { files: dirEntry.files, parsed };
}

// ── Register tail reader (gate-health, slice 260) ──────────────────────────
function _readRegisterTail(regPath, count, filter) {
  try {
    const raw = fs.readFileSync(regPath, 'utf-8').trim();
    if (!raw) return [];
    const lines = raw.split('\n');
    const result = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (!filter || filter(obj)) result.push(obj);
      } catch (_) { /* skip malformed */ }
    }
    return result.slice(-count);
  } catch (_) { return []; }
}

// Legacy file suffix (pre-D3 backward compat — files may still exist on disk)
const LEGACY_NEEDS_SUFFIX = '-NEEDS_' + 'AMEND' + 'MENT.md';
const LEGACY_VERDICT_REQ  = 'AMEND' + 'MENT_REQUIRED';
const LEGACY_VERDICT_NEED = 'AMEND' + 'MENT_NEEDED';
const LEGACY_NOTE_FIELD   = 'amend' + 'ment_note';

const QUEUE_ORDER  = path.join(REPO_ROOT, 'bridge', 'queue-order.json');
const STAGED_ORDER = path.join(REPO_ROOT, 'bridge', 'staged-order.json');

// ── Ensure staging directories exist ─────────────────────────────────────────
for (const dir of [STAGED_DIR, TRASH_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Sprint lookup ────────────────────────────────────────────────────────────
// Sprint 1: 001–056, Sprint 2: 057–088, Sprint 3: 089+
function getSprintForId(id) {
  const n = parseInt(id, 10);
  if (isNaN(n)) return null;
  if (n <= 56) return 1;
  if (n <= 88) return 2;
  return 3;
}

// ── Queue order persistence ──────────────────────────────────────────────────
function readQueueOrder() {
  try { return JSON.parse(fs.readFileSync(QUEUE_ORDER, 'utf8')); }
  catch (_) { return []; }
}
function writeQueueOrder(order) {
  fs.writeFileSync(QUEUE_ORDER, JSON.stringify(order, null, 2), 'utf8');
}

// ── Staged order persistence ────────────────────────────────────────────────
function readStagedOrder() {
  try { return JSON.parse(fs.readFileSync(STAGED_ORDER, 'utf8')); }
  catch (_) { return []; }
}
function writeStagedOrder(order) {
  fs.writeFileSync(STAGED_ORDER, JSON.stringify(order, null, 2), 'utf8');
}

// ── Frontmatter parser ───────────────────────────────────────────────────────
// Extracts key:value pairs from the YAML block between the first two `---` lines.
function parseFrontmatter(text) {
  const lines = text.split('\n');
  let inside = false;
  const result = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '---') {
      if (!inside) { inside = true; continue; }
      else { break; }
    }
    if (!inside) continue;
    // Skip comment lines
    if (trimmed.startsWith('<!--')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    let val = trimmed.slice(colon + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

// ── Body extractor ───────────────────────────────────────────────────────────
// Returns everything after the closing `---` of the YAML frontmatter block.
function extractBody(text) {
  const lines = text.split('\n');
  let dashes = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') dashes++;
    if (dashes === 2) return lines.slice(i + 1).join('\n').trim();
  }
  return '';
}

// ── Frontmatter updater ─────────────────────────────────────────────────────
// Sets or replaces key-value pairs in YAML frontmatter. Returns updated text.
function updateFrontmatter(text, updates) {
  const lines = text.split('\n');
  let start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (start === -1) { start = i; } else { end = i; break; }
    }
  }
  if (start === -1 || end === -1) return text;

  const fmLines = lines.slice(start + 1, end);
  for (const [key, val] of Object.entries(updates)) {
    const idx = fmLines.findIndex(l => {
      const c = l.indexOf(':');
      return c !== -1 && l.slice(0, c).trim() === key;
    });
    const newLine = `${key}: "${val}"`;
    if (idx !== -1) fmLines[idx] = newLine;
    else fmLines.push(newLine);
  }

  return [...lines.slice(0, start + 1), ...fmLines, ...lines.slice(end)].join('\n');
}

// ── JSON body reader ─────────────────────────────────────────────────────────
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (_) { resolve(null); }
    });
    req.on('error', reject);
  });
}

// ── Rounds array parser ─────────────────────────────────────────────────
// Extracts the rounds[] YAML array from slice file frontmatter.
// Each round entry is a set of key:value pairs in a YAML list item.
function parseRoundsArray(text) {
  const lines = text.split('\n');
  let inside = false;
  let inRounds = false;
  const rounds = [];
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '---') {
      if (!inside) { inside = true; continue; }
      else { break; }
    }
    if (!inside) continue;
    if (/^rounds:\s*$/.test(trimmed) || /^rounds:\s*\[\s*\]\s*$/.test(trimmed)) {
      inRounds = /^rounds:\s*$/.test(trimmed);
      continue;
    }
    if (inRounds) {
      // New list item
      if (/^\s*-\s+\w/.test(line)) {
        if (current) rounds.push(current);
        current = {};
        const kv = trimmed.replace(/^-\s+/, '');
        const c = kv.indexOf(':');
        if (c !== -1) {
          const k = kv.slice(0, c).trim();
          let v = kv.slice(c + 1).trim().replace(/^["']|["']$/g, '');
          current[k] = isNaN(Number(v)) ? v : Number(v);
        }
      } else if (/^\s{2,}\w/.test(line) && current) {
        // Continuation of current list item
        const c = trimmed.indexOf(':');
        if (c !== -1) {
          const k = trimmed.slice(0, c).trim();
          let v = trimmed.slice(c + 1).trim().replace(/^["']|["']$/g, '');
          current[k] = isNaN(Number(v)) ? v : Number(v);
        }
      } else if (/^\w/.test(trimmed)) {
        // New top-level key — end of rounds
        inRounds = false;
        if (current) { rounds.push(current); current = null; }
      }
    }
  }
  if (current) rounds.push(current);
  return rounds;
}

// ── Round-section extractor ──────────────────────────────────────────────────
// Parses a multi-round slice body for per-round rom_report / nog_review sections.
function extractRoundSections(body) {
  const sections = {};
  const lines = body.split('\n');
  let key = null;
  let buf = [];
  for (const line of lines) {
    const romM = line.match(/^##\s+Round\s+(\d+)/i);
    const nogM = line.match(/^##\s+Nog\s+(?:Review|Verdict)[^#\n]*Round\s+(\d+)/i);
    if (romM) {
      if (key) sections[key] = buf.join('\n').trim();
      key = `rom_${romM[1]}`; buf = [];
    } else if (nogM) {
      if (key) sections[key] = buf.join('\n').trim();
      key = `nog_${nogM[1]}`; buf = [];
    } else if (key) {
      buf.push(line);
    }
  }
  if (key) sections[key] = buf.join('\n').trim();
  return sections;
}

// ── Slice investigation builder ──────────────────────────────────────────────
// Returns { id, prompt, report, reviews } for a given slice ID.
// Accepts optional dirs override for testability: { queueDir, stagedDir }.
function buildSliceInvestigation(id, dirs) {
  const qDir = (dirs && dirs.queueDir) || QUEUE_DIR;
  const sDir = (dirs && dirs.stagedDir) || STAGED_DIR;
  const q = f => path.join(qDir, f);
  const s = f => path.join(sDir, f);

  // Prompt: earliest available file per precedence
  const promptFiles = [
    q(`${id}-IN_PROGRESS.md`), q(`${id}-QUEUED.md`), s(`${id}-STAGED.md`),
    q(`${id}-PARKED.md`), q(`${id}-STUCK.md`),
    q(`${id}-DONE.md`), q(`${id}-ERROR.md`), q(`${id}-ACCEPTED.md`),
  ];
  let prompt = null;
  for (const p of promptFiles) {
    if (fs.existsSync(p)) { prompt = extractBody(fs.readFileSync(p, 'utf8')); break; }
  }

  // Report: body of terminal file
  const termFiles = [
    q(`${id}-DONE.md`), q(`${id}-STUCK.md`), q(`${id}-ERROR.md`), q(`${id}-ACCEPTED.md`),
  ];
  let report = null;
  for (const p of termFiles) {
    if (fs.existsSync(p)) { report = extractBody(fs.readFileSync(p, 'utf8')); break; }
  }

  // Reviews: PARKED or STUCK (multi-round) → rounds[] → per-round entries
  let reviews = [];
  const parkedPath = q(`${id}-PARKED.md`);
  const stuckPath  = q(`${id}-STUCK.md`);
  const nogPath    = q(`${id}-NOG.md`);
  const multiPath  = fs.existsSync(parkedPath) ? parkedPath : fs.existsSync(stuckPath) ? stuckPath : null;

  if (multiPath) {
    const raw = fs.readFileSync(multiPath, 'utf8');
    const rounds = parseRoundsArray(raw);
    if (rounds.length > 0) {
      const secs = extractRoundSections(extractBody(raw));
      reviews = rounds.map(r => {
        const rn = typeof r.round === 'number' ? r.round : Number(r.round) || 1;
        return {
          round:      rn,
          verdict:    r.nog_verdict  ?? null,
          summary:    r.nog_reason   ?? null,
          rom_report: secs[`rom_${rn}`] || null,
          nog_review: secs[`nog_${rn}`] || r.nog_reason || null,
          done_at:    r.done_at      ?? null,
          durationMs: r.durationMs   ?? null,
          costUsd:    r.costUsd      ?? null,
        };
      });
    }
  } else if (fs.existsSync(nogPath)) {
    const nogRaw = fs.readFileSync(nogPath, 'utf8');
    const fm = parseFrontmatter(nogRaw);
    reviews = [{ round: 1, verdict: fm.verdict ?? null, summary: fm.summary ?? null,
                 rom_report: null, nog_review: extractBody(nogRaw) || null,
                 done_at: fm.completed ?? null, durationMs: null, costUsd: null }];
  }

  // 404 if nothing found
  const allDirs = [qDir, sDir];
  const found = allDirs.some(d => {
    try { return fs.readdirSync(d).some(f => f.startsWith(`${id}-`)); } catch (_) { return false; }
  });
  if (!found) {
    const e = new Error(`No slice found for ID ${id}`); e.status = 404; throw e;
  }

  return { id, prompt, report, reviews };
}

// ── Register reader ──────────────────────────────────────────────────────────
// All register reads route through the lifecycle translation shim so legacy
// event names (NOG_PASS, REVIEW_RECEIVED, ACCEPTED-as-event, etc.) are
// presented as canonical names to every consumer.
function readRegister() {
  const parsed = getCachedFile(REGISTER, raw => {
    return raw.split('\n').filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  });
  if (!parsed) return [];
  resetDedupeState();
  return parsed.map(ev => translateEvent(ev)).filter(Boolean);
}

// ── Register writer ──────────────────────────────────────────────────────────
function writeRegisterEvent(event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
  fs.appendFileSync(REGISTER, line, 'utf8');
}

// ── Title/goal fallback ─────────────────────────────────────────────────────
// First try the COMMISSIONED register event, then fall back to {id}-PARKED.md (or legacy ARCHIVED).
function getTitleAndGoal(id, commissioned) {
  if (commissioned[id]?.title) {
    return { title: commissioned[id].title, goal: commissioned[id].goal ?? null };
  }
  const parkedPath = path.join(QUEUE_DIR, `${id}-PARKED.md`);
  const legacyPath = path.join(QUEUE_DIR, `${id}-ARCHIVED.md`);
  try {
    const resolvedPath = fs.existsSync(parkedPath) ? parkedPath : legacyPath;
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const fm = parseFrontmatter(content);
    return { title: fm.title ?? null, goal: fm.goal ?? null };
  } catch (_) {
    return { title: null, goal: null };
  }
}

// ── Result-level caches (mtime-keyed) ───────────────────────────────────────
// Caches the full return value of buildBridgeData / buildCostsData so that
// downstream processing (translateEvent over 29K+ events, O(N) loops) is
// skipped entirely on cache hit.  Invalidated when source file mtimes change.
let _bridgeDataCache = { regMtime: null, hbMtime: null, value: null };
let _costsDataCache  = { regMtime: null, queueMtime: null, sessMtime: null, value: null };

function _getMtimeMs(filePath) {
  try { return fs.statSync(filePath).mtimeMs; } catch (_) { return null; }
}

function getCachedBridgeData() {
  const regMtime = _getMtimeMs(REGISTER);
  const hbMtime  = _getMtimeMs(HEARTBEAT);
  if (_bridgeDataCache.value !== null &&
      _bridgeDataCache.regMtime === regMtime &&
      _bridgeDataCache.hbMtime === hbMtime) {
    return _bridgeDataCache.value;
  }
  const value = buildBridgeData();
  _bridgeDataCache = { regMtime, hbMtime, value };
  return value;
}

function getCachedCostsData() {
  const regMtime   = _getMtimeMs(REGISTER);
  const queueMtime = _getMtimeMs(QUEUE_DIR);
  const sessMtime  = _getMtimeMs(SESSIONS);
  if (_costsDataCache.value !== null &&
      _costsDataCache.regMtime === regMtime &&
      _costsDataCache.queueMtime === queueMtime &&
      _costsDataCache.sessMtime === sessMtime) {
    return _costsDataCache.value;
  }
  const value = buildCostsData();
  _costsDataCache = { regMtime, queueMtime, sessMtime, value };
  return value;
}

// ── History outcome derivation (exported for testing) ────────────────────────
/**
 * deriveHistoryOutcome(id, rawOutcome, { mergedIds, squashedToDevIds, deferredIds, acceptedSet })
 *
 * Pure function: given an entry's id + raw DONE/ERROR outcome and the four
 * event-derived ID sets, returns the display outcome string.
 */
function deriveHistoryOutcome(id, rawOutcome, { mergedIds, squashedToDevIds, deferredIds, acceptedSet }) {
  if (mergedIds.has(id))              return 'MERGED';
  if (squashedToDevIds.has(id))       return 'ON_DEV';
  if (deferredIds.has(id))            return 'DEFERRED';
  if (rawOutcome === 'ERROR' && acceptedSet.has(id)) return 'ON_DEV';
  return rawOutcome;
}

// ── Bridge data builder ──────────────────────────────────────────────────────
function buildBridgeData() {
  // Heartbeat
  let heartbeat = { ts: null, status: 'down', current_slice: null,
                    slice_elapsed_seconds: null, processed_total: 0 };
  const hbRaw = getCachedFile(HEARTBEAT, raw => JSON.parse(raw));
  if (hbRaw) {
    const age = hbRaw.ts ? (Date.now() - new Date(hbRaw.ts).getTime()) / 1000 : Infinity;
    heartbeat = {
      ts:                        hbRaw.ts   ?? null,
      status:                    age < 60 ? (hbRaw.status ?? 'idle') : 'down',
      current_slice:             hbRaw.current_slice ?? null,
      slice_elapsed_seconds:     hbRaw.slice_elapsed_seconds ?? null,
      processed_total:           hbRaw.processed_total ?? 0,
    };
  }

  // First-output signal (invocation gap indicator)
  try {
    const fo = JSON.parse(fs.readFileSync(FIRST_OUTPUT, 'utf8'));
    heartbeat.firstOutputAt = fo.firstOutputAt ?? null;
  } catch (_) {
    heartbeat.firstOutputAt = null;
  }

  // Register events
  const events = readRegister();

  // Index COMMISSIONED events by id for goal lookup and recent title
  const commissioned = {};
  for (const ev of events) {
    if (ev.event === 'COMMISSIONED') commissioned[ev.id] = ev;
  }

  // Build recent (last 10 completed) and economics from DONE/ERROR events
  const completedMap = {};
  const reviewedMap  = {};
  const acceptedSet  = new Set();
  const economics = { totalTokensIn: 0, totalTokensOut: 0, totalCostUsd: 0, totalSlices: 0 };
  for (const ev of events) {
    if (ev.event === 'DONE' || ev.event === 'ERROR') {
      const { title: resolvedTitle, goal: resolvedGoal } = getTitleAndGoal(ev.id, commissioned);
      completedMap[ev.id] = {
        id:          ev.id,
        title:       resolvedTitle,
        goal:        resolvedGoal,
        outcome:     ev.event,
        durationMs:  ev.durationMs  ?? null,
        tokensIn:    ev.tokensIn    ?? null,
        tokensOut:   ev.tokensOut   ?? null,
        costUsd:     ev.costUsd     ?? null,
        completedAt: ev.ts          ?? null,
        reason:      ev.reason     ?? null,
      };
      if (ev.event === 'DONE') {
        economics.totalTokensIn  += ev.tokensIn  ?? 0;
        economics.totalTokensOut += ev.tokensOut ?? 0;
        economics.totalCostUsd   += ev.costUsd   ?? 0;
        economics.totalSlices++;
      }
    }
    // NOG_DECISION carries the verdict (translated from legacy REVIEWED/NOG_PASS)
    if (ev.event === 'NOG_DECISION') {
      reviewedMap[ev.id] = ev.verdict;
    }
    // HUMAN_APPROVAL or MERGED means the slice landed on main
    if (ev.event === 'HUMAN_APPROVAL' || ev.event === 'MERGED') {
      acceptedSet.add(ev.id);
    }
  }
  // API_RETRY events — last 20, newest first, for toast notification
  const apiRetries = events
    .filter(ev => ev.event === 'API_RETRY')
    .slice(-20)
    .reverse();

  // Build mergedIds from MERGED + SLICE_MERGED_TO_MAIN register events (terminal: landed on main)
  const mergedIds = new Set();
  // Build squashedToDevIds: slices squashed to dev but not yet through the gate
  const squashedToDevIds = new Set();
  // Build deferredIds: slices deferred because gate was running
  const deferredIds = new Set();
  for (const ev of events) {
    if (ev.event === 'MERGED' || ev.event === 'SLICE_MERGED_TO_MAIN') mergedIds.add(String(ev.id));
    if (ev.event === 'SLICE_SQUASHED_TO_DEV') squashedToDevIds.add(String(ev.id));
    if (ev.event === 'SLICE_DEFERRED') deferredIds.add(String(ev.id));
  }
  // Slices that were squashed to dev and later merged are not "on dev" — they're merged
  for (const id of mergedIds) squashedToDevIds.delete(id);
  // Slices that were deferred but later squashed are not deferred any more
  for (const id of squashedToDevIds) deferredIds.delete(id);
  for (const id of mergedIds) deferredIds.delete(id);

  const recent = Object.values(completedMap)
    .sort((a, b) => {
      if (!a.completedAt) return 1;
      if (!b.completedAt) return -1;
      return new Date(b.completedAt) - new Date(a.completedAt);
    })
    .slice(0, 200)
    .map(entry => {
      const verdict = reviewedMap[entry.id];
      const finalOutcome = deriveHistoryOutcome(entry.id, entry.outcome,
        { mergedIds, squashedToDevIds, deferredIds, acceptedSet });
      let reviewStatus;
      if (verdict === 'ACCEPTED')                reviewStatus = 'accepted';
      else if (verdict === 'APENDMENT_REQUIRED' || verdict === LEGACY_VERDICT_REQ) reviewStatus = 'apendment_required';
      else if (acceptedSet.has(entry.id))        reviewStatus = 'accepted';
      else                                       reviewStatus = 'waiting_for_review';
      return { ...entry, outcome: finalOutcome, reviewStatus, sprint: getSprintForId(entry.id) };
    });

  // Queue files (cached dir scan — avoids re-stat + re-parse of 348 files)
  const queueCache = getCachedDir(
    QUEUE_DIR,
    f => f.endsWith('.md'),
    (_fp, raw) => parseFrontmatter(raw),
  );
  const files = queueCache.files;

  // Build terminal ID set: filesystem ACCEPTED/ARCHIVED/SLICE markers + MERGED events
  const terminalIds = new Set(mergedIds);
  for (const f of files) {
    const tm = f.match(/^(.+?)-(ACCEPTED|ARCHIVED|ERROR|STUCK|SLICE)\.md$/);
    if (tm) terminalIds.add(String(tm[1]));
  }

  const queue = { waiting: 0, active: 0, done: 0, error: 0 };
  const slices = [];

  for (const filename of files) {
    // Derive state from filename suffix: {id}-{STATE}.md
    const match = filename.match(/^(.+?)-(PENDING|QUEUED|IN_PROGRESS|DONE|ERROR)\.md$/);
    if (!match) continue;
    const [, rawId, state] = match;

    // Skip terminal slices (merged to main or marked ACCEPTED/ARCHIVED/SLICE)
    if (terminalIds.has(rawId)) continue;

    // Hide stale DONE entries from the Queue panel.
    // Prefer frontmatter `completed` (immune to mtime refresh by recovery ops);
    // fall back to mtime when `completed` is missing or unparseable.
    if (state === 'DONE') {
      const staleCutoff = STALE_DONE_DAYS * 86400 * 1000;
      const fm0 = queueCache.parsed[filename] || {};
      const completedMs = fm0.completed ? new Date(fm0.completed).getTime() : NaN;
      if (!isNaN(completedMs)) {
        if (Date.now() - completedMs > staleCutoff) continue;
      } else {
        try {
          const mtimeMs = fs.statSync(path.join(QUEUE_DIR, filename)).mtimeMs;
          if (Date.now() - mtimeMs > staleCutoff) continue;
        } catch (_) {}
      }
    }

    switch (state) {
      case 'PENDING':     queue.waiting++; break;
      case 'QUEUED':      queue.waiting++; break;
      case 'IN_PROGRESS': queue.active++;  break;
      case 'DONE':        queue.done++;    break;
      case 'ERROR':       queue.error++;   break;
    }

    const fm = queueCache.parsed[filename] || {};

    const id = fm.id ?? rawId;
    const goalFromRegister = commissioned[id]?.goal ?? null;
    const goalFromFm       = fm.goal ?? null;

    // For ERROR/DONE state, the file's own title is a watcher-generated fallback
    // ("Slice N — crash"). Prefer the real title from the COMMISSIONED event or
    // the SLICE archive so the error display shows something meaningful.
    const { title: betterTitle, goal: betterGoal } = (state === 'ERROR' || state === 'DONE')
      ? getTitleAndGoal(id, commissioned)
      : { title: null, goal: null };

    slices.push({
      id,
      title:     betterTitle ?? fm.title ?? filename,
      state,
      from:      fm.from      ?? null,
      created:   fm.created   ?? null,
      completed: fm.completed ?? null,
      goal:           betterGoal ?? goalFromRegister ?? goalFromFm,
      references:     fm.references ?? null,
      sprint:         fm.sprint ? parseInt(fm.sprint, 10) : getSprintForId(id),
      apiRetryCount:  fm._api_retry_count ? parseInt(fm._api_retry_count, 10) : 0,
    });
  }

  // Sort by numeric ID descending
  slices.sort((a, b) => {
    const na = parseInt(a.id, 10);
    const nb = parseInt(b.id, 10);
    if (!isNaN(na) && !isNaN(nb)) return nb - na;
    return b.id.localeCompare(a.id);
  });

  const queueOrder = readQueueOrder();
  const stagedOrder = readStagedOrder();

  // Nog active state (slice 105)
  let nogActive = null;
  try {
    const raw = JSON.parse(fs.readFileSync(NOG_ACTIVE, 'utf8'));
    if (raw && raw.sliceId) nogActive = raw;
  } catch (_) {}

  return { heartbeat, queue, slices, recent, economics, queueOrder, stagedOrder, nogActive, apiRetries, events };
}

// ── Cost Center aggregation ──────────────────────────────────────────────────
function buildCostsData() {
  // Rom — sum DONE events from register.jsonl (cached parse)
  const romRow = { role: 'rom', model: 'claude-sonnet-4-6', count: 0,
                   tokens_in: 0, tokens_out: 0, cost_usd: 0 };
  const regParsed = getCachedFile(REGISTER, raw => {
    return raw.split('\n').filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  });
  if (regParsed) {
    for (const ev of regParsed) {
      if (ev.event !== 'DONE') continue;
      romRow.count++;
      romRow.tokens_in  += ev.tokensIn  ?? 0;
      romRow.tokens_out += ev.tokensOut ?? 0;
      romRow.cost_usd   += ev.costUsd   ?? 0;
    }
  }

  // Nog — sum rounds[] across all DONE.md files in queue/
  const nogRow = { role: 'nog', model: 'claude-sonnet-4-6', count: 0,
                   tokens_in: 0, tokens_out: 0, cost_usd: 0 };
  try {
    const files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('-DONE.md'));
    for (const file of files) {
      let text;
      try { text = fs.readFileSync(path.join(QUEUE_DIR, file), 'utf8'); }
      catch (_) { continue; }
      const rounds = parseRoundsArray(text);
      for (const r of rounds) {
        nogRow.count++;
        nogRow.tokens_in  += r.tokensIn  ?? 0;
        nogRow.tokens_out += r.tokensOut ?? 0;
        nogRow.cost_usd   += r.costUsd   ?? 0;
      }
    }
  } catch (_) {}

  // Sessions — group by role from sessions.jsonl
  const sessionsByRole = {};
  let updatedAt = new Date().toISOString();
  try {
    const raw = fs.readFileSync(SESSIONS, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch (_) { continue; }
      const role = entry.role ?? 'unknown';
      if (!sessionsByRole[role]) {
        sessionsByRole[role] = {
          role,
          model: entry.model ?? 'claude-sonnet-4-6',
          count: 0,
          tokens_in: 0,
          tokens_out: 0,
          cost_usd: 0,
          _has_cost: false,
        };
      }
      const row = sessionsByRole[role];
      row.count++;
      if (entry.tokens_in  != null) row.tokens_in  += entry.tokens_in;
      if (entry.tokens_out != null) row.tokens_out += entry.tokens_out;
      if (entry.cost_usd   != null) { row.cost_usd += entry.cost_usd; row._has_cost = true; }
      if (entry.ts && entry.ts > updatedAt) updatedAt = entry.ts;
    }
  } catch (_) {}

  // Normalise session rows: null out aggregates when no values were present
  const sessionRows = Object.values(sessionsByRole).map(row => {
    const out = { role: row.role, model: row.model, count: row.count,
                  tokens_in: null, tokens_out: null, cost_usd: null };
    if (row._has_cost || row.tokens_in > 0) {
      if (row.tokens_in  > 0) out.tokens_in  = row.tokens_in;
      if (row.tokens_out > 0) out.tokens_out = row.tokens_out;
      if (row._has_cost)      out.cost_usd   = row.cost_usd;
    }
    return out;
  });

  const by_role = [romRow, nogRow, ...sessionRows];

  // Total: sum only non-null cost entries
  let total_cost_usd = romRow.cost_usd + nogRow.cost_usd;
  for (const row of sessionRows) {
    if (row.cost_usd != null) total_cost_usd += row.cost_usd;
  }

  return { by_role, total_cost_usd, updated_at: updatedAt };
}

// ── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (pathname === '/' || pathname === '/index.html') {
    fs.readFile(DASHBOARD, (err, data) => {
      if (err) { res.writeHead(500); res.end('Internal Server Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (pathname === '/tokens.css') {
    fs.readFile(TOKENS_CSS, (err, data) => {
      if (err) { res.writeHead(500); res.end('Internal Server Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (pathname === '/api/bridge/review') {
    const corsHeaders = {
      'Access-Control-Allow-Origin':  CORS_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain', ...corsHeaders });
      res.end('Method Not Allowed');
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); }
      catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const { id, verdict, reason } = payload;
      const VALID_VERDICTS = ['ACCEPTED', 'APENDMENT_NEEDED', LEGACY_VERDICT_NEED, 'STUCK'];
      if (!id || !verdict) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'Missing required fields: id, verdict' }));
        return;
      }
      if (!VALID_VERDICTS.includes(verdict)) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: `Invalid verdict. Must be one of: ${VALID_VERDICTS.join(', ')}` }));
        return;
      }

      // UI-refresh nudge only — the watcher writes REVIEW_RECEIVED to
      // register.jsonl synchronously. This endpoint no longer touches the
      // register; it exists so legacy callers get a 200 instead of a 404.
      console.log(`[review-nudge] POST /api/bridge/review id=${id} verdict=${verdict} (no register write)`);

      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ ok: true, nudge: true }));
    });
    return;
  }

  // ── Staged slice endpoints ──────────────────────────────────────────────
  if (pathname === '/api/bridge/staged' && req.method === 'GET') {
    let files = [];
    try { files = fs.readdirSync(STAGED_DIR).filter(f => f.endsWith('-STAGED.md') || f.endsWith('-NEEDS_APENDMENT.md') || f.endsWith(LEGACY_NEEDS_SUFFIX)); }
    catch (_) {}

    const items = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(STAGED_DIR, file), 'utf8');
        const fm = parseFrontmatter(content);
        const body = extractBody(content);
        const status = (file.endsWith('-NEEDS_APENDMENT.md') || file.endsWith(LEGACY_NEEDS_SUFFIX)) ? 'NEEDS_APENDMENT' : (fm.status || 'STAGED');
        const itemId = fm.id ?? file.replace(/-(STAGED|NEEDS_APENDMENT|NEEDS_AMEND\w+)\.md$/, '');
        items.push({
          id:              itemId,
          title:           fm.title ?? null,
          summary:         fm.summary ?? null,
          goal:            fm.goal ?? null,
          status,
          apendment_note:  fm.apendment_note ?? fm[LEGACY_NOTE_FIELD] ?? null,
          references:      fm.references ?? null,
          sprint:          fm.sprint ? parseInt(fm.sprint, 10) : getSprintForId(itemId),
          body,
        });
      } catch (_) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(items));
    return;
  }

  const stagedMatch = pathname.match(/^\/api\/bridge\/staged\/(\d+)\/(approve|slice|amend|reject|update-body)$/);
  if (stagedMatch) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    const id     = stagedMatch[1];
    const action = stagedMatch[2];

    // Find the staged file (could be STAGED or NEEDS_APENDMENT or legacy suffix)
    const stagedPath     = path.join(STAGED_DIR, `${id}-STAGED.md`);
    const apendmentPath  = path.join(STAGED_DIR, `${id}-NEEDS_APENDMENT.md`);
    const legacyAmdPath  = path.join(STAGED_DIR, `${id}${LEGACY_NEEDS_SUFFIX}`);
    const filePath = fs.existsSync(stagedPath) ? stagedPath
                   : fs.existsSync(apendmentPath) ? apendmentPath
                   : fs.existsSync(legacyAmdPath) ? legacyAmdPath
                   : null;

    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Staged slice ${id} not found` }));
      return;
    }

    if (action === 'approve' || action === 'slice') {
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        content = updateFrontmatter(content, { status: 'QUEUED' });
        fs.writeFileSync(path.join(QUEUE_DIR, `${id}-QUEUED.md`), content, 'utf8');
        try { fs.renameSync(filePath, path.join(TRASH_DIR, path.basename(filePath) + '.approved')); } catch (_) {}
        // Add to queue order (apendments go to front, others to end)
        const order = readQueueOrder();
        const fm2 = parseFrontmatter(content);
        if (fm2.references && fm2.references !== 'null') {
          // Apendment: insert at front
          order.unshift(id);
        } else if (!order.includes(id)) {
          order.push(id);
        }
        writeQueueOrder(order);
        writeRegisterEvent({ event: 'HUMAN_APPROVAL', slice_id: id, action: 'approved' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (action === 'amend') {
      const payload = await readJsonBody(req);
      if (!payload || !payload.note) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required field: note' }));
        return;
      }
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        content = updateFrontmatter(content, { status: 'NEEDS_APENDMENT', apendment_note: payload.note });
        // Rename to NEEDS_APENDMENT if currently STAGED
        const destPath = path.join(STAGED_DIR, `${id}-NEEDS_APENDMENT.md`);
        fs.writeFileSync(destPath, content, 'utf8');
        if (filePath !== destPath) { try { fs.renameSync(filePath, path.join(TRASH_DIR, path.basename(filePath) + '.amended')); } catch (_) {} }
        writeRegisterEvent({ event: 'HUMAN_APPROVAL', slice_id: id, action: 'refined' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (action === 'update-body') {
      const payload = await readJsonBody(req);
      if (!payload || typeof payload.body !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required field: body' }));
        return;
      }
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const lines = raw.split('\n');
        let dashes = 0, fmEnd = -1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim() === '---') dashes++;
          if (dashes === 2) { fmEnd = i; break; }
        }
        if (fmEnd === -1) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Could not parse frontmatter' }));
          return;
        }
        const updated = lines.slice(0, fmEnd + 1).join('\n') + '\n\n' + payload.body;
        fs.writeFileSync(filePath, updated, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (action === 'reject') {
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        content = updateFrontmatter(content, { status: 'REJECTED' });
        try { fs.renameSync(filePath, path.join(TRASH_DIR, `${id}-REJECTED.md`)); } catch (_) { fs.writeFileSync(path.join(TRASH_DIR, `${id}-REJECTED.md`), content, 'utf8'); }
        writeRegisterEvent({ event: 'HUMAN_APPROVAL', slice_id: id, action: 'rejected' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }
  }

  // ── Un-approve: move queued slice back to staged ────────────────────────
  const unapproveMatch = pathname.match(/^\/api\/slice\/(\d+)\/unapprove$/);
  if (unapproveMatch && req.method === 'POST') {
    const id = unapproveMatch[1];

    // Check if the slice is the currently-dispatched slice (race protection)
    let hbCurrent = null;
    try {
      const hb = JSON.parse(fs.readFileSync(HEARTBEAT, 'utf8'));
      hbCurrent = hb.current_slice ? String(hb.current_slice) : null;
    } catch (_) {}
    if (hbCurrent === id) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'already-picked-up' }));
      return;
    }

    // Find the QUEUED file
    const queuedPath = path.join(QUEUE_DIR, `${id}-QUEUED.md`);
    if (!fs.existsSync(queuedPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Queued slice ${id} not found` }));
      return;
    }

    try {
      // Read current queue position before removal
      const qOrder = readQueueOrder();
      const prevPosition = qOrder.indexOf(id);

      // Move file: QUEUED → STAGED in staged dir
      let content = fs.readFileSync(queuedPath, 'utf8');
      content = updateFrontmatter(content, { status: 'STAGED' });
      fs.writeFileSync(path.join(STAGED_DIR, `${id}-STAGED.md`), content, 'utf8');
      try { fs.unlinkSync(queuedPath); } catch (_) {}

      // Update queue-order.json: remove from queue
      const newQueueOrder = qOrder.filter(oid => oid !== id);
      writeQueueOrder(newQueueOrder);

      // Update staged-order.json: append to end
      const sOrder = readStagedOrder();
      if (!sOrder.includes(id)) sOrder.push(id);
      writeStagedOrder(sOrder);

      // Emit register event
      writeRegisterEvent({ event: 'slice-unapproved', slice_id: id, prev_position: prevPosition });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Archive (remove from queue): move queued slice to trash ─────────────
  const archiveMatch = pathname.match(/^\/api\/queue\/(\d+)\/remove$/);
  if (archiveMatch && req.method === 'POST') {
    const id = archiveMatch[1];

    // Race protection: if currently dispatched, reject
    let hbCurrent = null;
    try {
      const hb = JSON.parse(fs.readFileSync(HEARTBEAT, 'utf8'));
      hbCurrent = hb.current_slice ? String(hb.current_slice) : null;
    } catch (_) {}
    if (hbCurrent === id) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'already-picked-up' }));
      return;
    }

    // Validate QUEUED file exists
    const queuedPath = path.join(QUEUE_DIR, `${id}-QUEUED.md`);
    if (!fs.existsSync(queuedPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Queued slice ${id} not found` }));
      return;
    }

    try {
      // Remove from queue-order.json
      const qOrder = readQueueOrder();
      const newQueueOrder = qOrder.filter(oid => oid !== id);
      writeQueueOrder(newQueueOrder);

      // Move QUEUED file to trash with timestamp
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const trashName = `${id}-QUEUED.md.removed-${ts}`;
      try { fs.renameSync(queuedPath, path.join(TRASH_DIR, trashName)); }
      catch (_) {
        const content = fs.readFileSync(queuedPath, 'utf8');
        fs.writeFileSync(path.join(TRASH_DIR, trashName), content, 'utf8');
        fs.unlinkSync(queuedPath);
      }

      // Register event
      writeRegisterEvent({ event: 'slice-archived-from-queue', slice_id: id, ts: new Date().toISOString(), reason: 'user-removed' });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, action: 'archived' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Error detail endpoints (slice 094/104) ──────────────────────────────
  const ERRORS_DIR = path.join(REPO_ROOT, 'bridge', 'errors');

  const errorDetailMatch = pathname.match(/^\/api\/bridge\/errors\/(\d+)$/);

  if (errorDetailMatch && req.method === 'GET') {
    const id = errorDetailMatch[1];
    const filePath = path.join(ERRORS_DIR, `${id}-ERROR.json`);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(raw);
    } catch (_) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    }
    return;
  }

  if (pathname === '/api/bridge/errors' && req.method === 'GET') {
    try {
      const files = fs.readdirSync(ERRORS_DIR).filter(f => f.endsWith('-ERROR.json'));
      const items = [];
      for (const file of files) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(ERRORS_DIR, file), 'utf8'));
          items.push(raw);
        } catch (_) {}
      }
      items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(items.slice(0, 20)));
    } catch (_) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return;
  }

  if (pathname === '/api/health') {
    const now = Date.now();
    let watcher = { status: 'down', heartbeatAge_s: null, currentSlice: null,
                    elapsedSeconds: null, lastActivityAge_s: null, processedTotal: 0 };
    const hbHealth = getCachedFile(HEARTBEAT, raw => JSON.parse(raw));
    if (hbHealth) {
      const age = hbHealth.ts ? (now - new Date(hbHealth.ts).getTime()) / 1000 : Infinity;
      const status = age < 30 ? 'up' : age < 60 ? 'stale' : 'down';
      const lastActivityAge = hbHealth.last_activity_ts
        ? (now - new Date(hbHealth.last_activity_ts).getTime()) / 1000 : null;
      watcher = {
        status,
        heartbeatAge_s:    Math.round(age),
        currentSlice:      hbHealth.current_slice ?? null,
        elapsedSeconds:    hbHealth.slice_elapsed_seconds ?? null,
        lastActivityAge_s: lastActivityAge != null ? Math.round(lastActivityAge) : null,
        processedTotal:    hbHealth.processed_total ?? 0,
      };
    }
    const wormholePath = path.join(REPO_ROOT, 'bridge', 'wormhole-heartbeat.json');
    let wormhole = { lastWriteTs: null, lastWriteTool: null, lastWritePath: null, ageSeconds: null };
    try {
      const raw = JSON.parse(fs.readFileSync(wormholePath, 'utf8'));
      const age = raw.ts ? (now - new Date(raw.ts).getTime()) / 1000 : Infinity;
      wormhole = { lastWriteTs: raw.ts ?? null, lastWriteTool: raw.tool ?? null,
                   lastWritePath: raw.path ?? null, ageSeconds: raw.ts ? Math.round(age) : null };
    } catch (_) {}
    // Read host-side health detector status (written by host-health-detector.sh)
    let hostHealth = null;
    try {
      hostHealth = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'bridge', 'host-health.json'), 'utf8'));
    } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', ts: new Date().toISOString(), watcher, wormhole, hostHealth }));
    return;
  }

  // ── Gate Health endpoint (slice 260) ──────────────────────────────────────
  if (pathname === '/api/gate-health' && req.method === 'GET') {
    const { evaluateAlerts, computeHealthColor } = require(path.join(REPO_ROOT, 'bridge', 'state', 'gate-alerts'));
    const STATE_DIR = path.join(REPO_ROOT, 'bridge', 'state');
    const mutexPath = path.join(STATE_DIR, 'gate-running.json');
    const bashirHbPath = path.join(STATE_DIR, 'bashir-heartbeat.json');

    // Read mutex state
    let mutexState = null;
    try { mutexState = JSON.parse(fs.readFileSync(mutexPath, 'utf8')); } catch (_) {}

    // Read heartbeat
    let heartbeatAge = null;
    let heartbeatExists = false;
    try {
      const hb = JSON.parse(fs.readFileSync(bashirHbPath, 'utf8'));
      heartbeatExists = true;
      if (hb.ts) heartbeatAge = Date.now() - new Date(hb.ts).getTime();
    } catch (err) {
      if (err.code !== 'ENOENT') heartbeatExists = true; // exists but unreadable
    }

    // Last lock-cycle duration from register
    let lastLockCycleDuration = null;
    const regTail = _readRegisterTail(REGISTER, 50, e => e.event && (e.event.startsWith('gate-') || e.event === 'lock-cycle'));
    const lockEvents = regTail.filter(e => e.event === 'lock-cycle');
    if (lockEvents.length > 0) {
      lastLockCycleDuration = lockEvents[lockEvents.length - 1].held_duration_ms || null;
    }

    const alerts = evaluateAlerts({ mutexState, heartbeatAge, heartbeatExists, recentEvents: regTail });
    const color = computeHealthColor(alerts);
    const last5 = regTail.slice(-5);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      color,
      mutex: mutexState ? { present: true, started_ts: mutexState.started_ts, dev_tip_sha: mutexState.dev_tip_sha } : { present: false },
      heartbeat: { exists: heartbeatExists, age_ms: heartbeatAge },
      last_lock_cycle_duration_ms: lastLockCycleDuration,
      alerts,
      recent_events: last5,
    }));
    return;
  }

  // ── Queue slice content (for slice detail overlay) ─────────────────────────
  const queueContentMatch = pathname.match(/^\/api\/queue\/(\d+)\/content$/);
  if (queueContentMatch && req.method === 'GET') {
    const id = queueContentMatch[1];
    // PARKED.md is the original prompt given to O'Brien — show it first.
    // Fall back to legacy ARCHIVED, then PENDING (same content, still in queue) then STAGED, then DONE report.
    const candidates = [
      path.join(QUEUE_DIR, `${id}-PARKED.md`),
      path.join(QUEUE_DIR, `${id}-ARCHIVED.md`),
      path.join(QUEUE_DIR, `${id}-QUEUED.md`),
      path.join(QUEUE_DIR, `${id}-PENDING.md`),
      path.join(STAGED_DIR, `${id}-STAGED.md`),
      path.join(STAGED_DIR, `${id}-NEEDS_APENDMENT.md`),
      path.join(STAGED_DIR, `${id}${LEGACY_NEEDS_SUFFIX}`),
      path.join(QUEUE_DIR, `${id}-ACCEPTED.md`),
      path.join(QUEUE_DIR, `${id}-IN_REVIEW.md`),
      path.join(QUEUE_DIR, `${id}-REVIEWED.md`),
      path.join(QUEUE_DIR, `${id}-DONE.md`),
    ];
    let found = null;
    for (const p of candidates) {
      if (fs.existsSync(p)) { found = p; break; }
    }
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No content found for slice ${id}` }));
      return;
    }
    try {
      const raw = fs.readFileSync(found, 'utf8');
      const frontmatter = parseFrontmatter(raw);
      const body = extractBody(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, frontmatter, body, raw }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Return-to-stage (writes control file for watcher) ────────────────────
  const returnMatch = pathname.match(/^\/api\/bridge\/return-to-stage\/(\d+)$/);
  if (returnMatch && req.method === 'POST') {
    const id = returnMatch[1];
    // Ensure control dir exists
    if (!fs.existsSync(CONTROL_DIR)) fs.mkdirSync(CONTROL_DIR, { recursive: true });
    const controlFile = path.join(CONTROL_DIR, `return-${id}-${Date.now()}.json`);
    try {
      fs.writeFileSync(controlFile, JSON.stringify({ action: 'return_to_stage', slice_id: id }), 'utf8');
      writeRegisterEvent({ event: 'RETURN_TO_STAGE_REQUESTED', slice_id: id, source: 'dashboard' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Pause / Resume / Abort (write control files for watcher) ─────────────
  const controlMatch = pathname.match(/^\/api\/bridge\/(pause|resume|abort)\/(\d+)$/);
  if (controlMatch && req.method === 'POST') {
    const action = controlMatch[1];
    const id = controlMatch[2];
    if (!fs.existsSync(CONTROL_DIR)) fs.mkdirSync(CONTROL_DIR, { recursive: true });
    const controlFile = path.join(CONTROL_DIR, `${action}-${id}-${Date.now()}.json`);
    try {
      fs.writeFileSync(controlFile, JSON.stringify({ action, slice_id: id }), 'utf8');
      writeRegisterEvent({ event: `${action.toUpperCase()}_REQUESTED`, slice_id: id, source: 'dashboard' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Slice frontmatter endpoint (for rounds[] and total_* fields) ─────────
  const sliceFmMatch = pathname.match(/^\/api\/slice\/(\d+)\/frontmatter$/);
  if (sliceFmMatch && req.method === 'GET') {
    const id = sliceFmMatch[1];
    // Search queue dir, staged dir for any file with this ID
    const dirs = [QUEUE_DIR, STAGED_DIR];
    let found = null;
    for (const dir of dirs) {
      try {
        const files = fs.readdirSync(dir).filter(f => f.startsWith(`${id}-`) && f.endsWith('.md'));
        if (files.length > 0) {
          found = path.join(dir, files[0]);
          break;
        }
      } catch (_) {}
    }
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No slice file found for ID ${id}` }));
      return;
    }
    try {
      const raw = fs.readFileSync(found, 'utf8');
      const fm = parseFrontmatter(raw);
      // Parse rounds[] from the YAML frontmatter (simple line-by-line)
      const rounds = parseRoundsArray(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, frontmatter: fm, rounds }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Slice investigation: prompt + report + per-round reviews ─────────────
  const sliceInvMatch = pathname.match(/^\/api\/slice\/(\d+)$/);
  if (sliceInvMatch && req.method === 'GET') {
    const id = sliceInvMatch[1];
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildSliceInvestigation(id)));
    } catch (err) {
      const status = err.status === 404 ? 404 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }

  // 400 for any /api/slice/* that didn't match a valid route above (non-numeric ID)
  if (pathname.startsWith('/api/slice/') && req.method === 'GET') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Slice ID must be numeric' }));
    return;
  }

  // ── Queue order persistence (drag-reorder) ──────────────────────────────────
  if (pathname === '/api/queue/order' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { order } = JSON.parse(body);
        if (!Array.isArray(order)) throw new Error('order must be array');
        writeQueueOrder(order.map(String));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── Staged order persistence (drag-reorder) ────────────────────────────────
  if (pathname === '/api/staged/order' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { order } = JSON.parse(body);
        if (!Array.isArray(order)) throw new Error('order must be array');
        writeStagedOrder(order.map(String));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/bridge') {
    const corsHeaders = {
      'Access-Control-Allow-Origin':  CORS_ORIGIN,
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    let data;
    try { data = getCachedBridgeData(); }
    catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify(data));
    return;
  }

  // ── Cost Center ─────────────────────────────────────────────────────────
  if (pathname === '/api/costs' && req.method === 'GET') {
    try {
      const result = getCachedCostsData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── Gate start (slice 265) ─────────────────────────────────────────────────
  if (pathname === '/api/gate/start' && req.method === 'POST') {
    // Validate branch-state preconditions
    let branchState;
    try {
      branchState = JSON.parse(fs.readFileSync(BRANCH_STATE, 'utf8'));
    } catch (_) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'branch-state-unavailable' }));
      return;
    }

    const gateStatus = branchState.gate ? branchState.gate.status : 'IDLE';
    if (gateStatus === 'GATE_RUNNING' || gateStatus === 'GATE_FAILED' || gateStatus === 'GATE_ABORTED') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'gate-not-idle', status: gateStatus }));
      return;
    }

    const commitsAhead = branchState.dev ? (branchState.dev.commits_ahead_of_main || 0) : 0;
    if (commitsAhead === 0) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'nothing-to-gate' }));
      return;
    }

    // Invoke orchestrator's startGate()
    try {
      const { startGate } = require(path.join(REPO_ROOT, 'bridge', 'orchestrator'));
      const result = startGate();
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ started: true, dev_tip_sha: result.devTipSha }));
    } catch (err) {
      if (err.code === 'MUTEX_HELD') {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'gate-not-idle', status: 'GATE_RUNNING' }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return;
  }

  // ── Gate events (slice 265) — lightweight poll endpoint for client event dispatch
  if (pathname === '/api/gate/events' && req.method === 'GET') {
    const GATE_LIFECYCLE_EVENTS = new Set([
      'gate-start', 'tests-updated', 'regression-pass',
      'regression-fail', 'merge-complete', 'gate-abort',
    ]);
    const events = _readRegisterTail(REGISTER, 20, e => GATE_LIFECYCLE_EVENTS.has(e.event));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(events));
    return;
  }

  // ── Gate abort (slice 271) ─────────────────────────────────────────────────
  if (pathname === '/api/gate/abort' && req.method === 'POST') {
    // Validate branch-state preconditions
    let branchState;
    try {
      branchState = JSON.parse(fs.readFileSync(BRANCH_STATE, 'utf8'));
    } catch (_) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'branch-state-unavailable' }));
      return;
    }

    const gateStatus = branchState.gate ? branchState.gate.status : 'IDLE';
    if (gateStatus !== 'GATE_FAILED' && gateStatus !== 'GATE_ABORTED') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'gate-not-failed', status: gateStatus }));
      return;
    }

    try {
      const { abortGate } = require(path.join(REPO_ROOT, 'bridge', 'orchestrator'));
      const result = abortGate();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      if (err.code === 'INVALID_STATE') {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'gate-not-failed', status: err.status }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return;
  }

  // ── Gate state-doctor health (slice 271) ──────────────────────────────────
  if (pathname === '/api/gate/doctor' && req.method === 'GET') {
    try {
      const { execFileSync } = require('child_process');
      const output = execFileSync('node', [path.join(REPO_ROOT, 'bridge', 'state-doctor.js'), '--gate-health'], {
        encoding: 'utf-8',
        timeout: 10000,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ output }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ output: err.stdout || err.message, error: true }));
    }
    return;
  }

  // ── Register tail (slice 271) — last N register events for Investigate panel
  if (pathname === '/api/gate/register-tail' && req.method === 'GET') {
    const events = _readRegisterTail(REGISTER, 50, e => {
      const ts = e.ts;
      // Return events since last gate-start
      return e.event && (e.event.startsWith('gate-') || e.event === 'lock-cycle' ||
        e.event === 'regression-pass' || e.event === 'regression-fail' ||
        e.event === 'tests-updated' || e.event === 'merge-complete');
    });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(events));
    return;
  }

  // ── Branch state (slice 262) ───────────────────────────────────────────────
  if (pathname === '/api/branch-state' && req.method === 'GET') {
    try {
      const raw = fs.readFileSync(BRANCH_STATE, 'utf8');
      const parsed = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(parsed));
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'branch-state-unavailable' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`LCARS dashboard server running at http://${HOST}:${PORT}`);
  });
}

module.exports = { buildSliceInvestigation, parseFrontmatter, extractBody, parseRoundsArray, extractRoundSections, getCachedFile, getCachedDir, _cache, getCachedBridgeData, getCachedCostsData, buildBridgeData, buildCostsData, STALE_DONE_DAYS, deriveHistoryOutcome };
