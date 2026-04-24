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

const FIRST_OUTPUT  = path.join(REPO_ROOT, 'bridge', 'first-output.json');
const NOG_ACTIVE    = path.join(REPO_ROOT, 'bridge', 'nog-active.json');
const CONTROL_DIR   = path.join(REPO_ROOT, 'bridge', 'control');
const SESSIONS      = path.join(REPO_ROOT, 'bridge', 'sessions.jsonl');
const { translateEvent, resetDedupeState } = require(path.join(REPO_ROOT, 'bridge', 'lifecycle-translate'));

const CORS_ORIGIN  = 'https://dax-dashboard.lovable.app';

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

// ── Register reader ──────────────────────────────────────────────────────────
// All register reads route through the lifecycle translation shim so legacy
// event names (NOG_PASS, REVIEW_RECEIVED, ACCEPTED-as-event, etc.) are
// presented as canonical names to every consumer.
function readRegister() {
  try {
    const raw = fs.readFileSync(REGISTER, 'utf8');
    const parsed = raw.split('\n').filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
    resetDedupeState();
    return parsed.map(ev => translateEvent(ev)).filter(Boolean);
  } catch (_) { return []; }
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

// ── Bridge data builder ──────────────────────────────────────────────────────
function buildBridgeData() {
  // Heartbeat
  let heartbeat = { ts: null, status: 'down', current_slice: null,
                    slice_elapsed_seconds: null, processed_total: 0 };
  try {
    const raw = JSON.parse(fs.readFileSync(HEARTBEAT, 'utf8'));
    const age = raw.ts ? (Date.now() - new Date(raw.ts).getTime()) / 1000 : Infinity;
    heartbeat = {
      ts:                        raw.ts   ?? null,
      status:                    age < 60 ? (raw.status ?? 'idle') : 'down',
      current_slice:             raw.current_slice ?? null,
      slice_elapsed_seconds:     raw.slice_elapsed_seconds ?? null,
      processed_total:           raw.processed_total ?? 0,
    };
  } catch (_) { /* file missing or malformed → keep defaults */ }

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

  const recent = Object.values(completedMap)
    .sort((a, b) => {
      if (!a.completedAt) return 1;
      if (!b.completedAt) return -1;
      return new Date(b.completedAt) - new Date(a.completedAt);
    })
    .slice(0, 200)
    .map(entry => {
      const verdict = reviewedMap[entry.id];
      // If watcher errored but Philipp accepted it, show final outcome as ACCEPTED
      const finalOutcome = (entry.outcome === 'ERROR' && acceptedSet.has(entry.id))
        ? 'ACCEPTED' : entry.outcome;
      let reviewStatus;
      if (verdict === 'ACCEPTED')                reviewStatus = 'accepted';
      else if (verdict === 'APENDMENT_REQUIRED' || verdict === LEGACY_VERDICT_REQ) reviewStatus = 'apendment_required';
      else if (acceptedSet.has(entry.id))        reviewStatus = 'accepted';
      else                                       reviewStatus = 'waiting_for_review';
      return { ...entry, outcome: finalOutcome, reviewStatus, sprint: getSprintForId(entry.id) };
    });

  // Queue files
  let files = [];
  try { files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.md')); }
  catch (_) {}

  const queue = { waiting: 0, active: 0, done: 0, error: 0 };
  const slices = [];

  for (const filename of files) {
    // Derive state from filename suffix: {id}-{STATE}.md
    const match = filename.match(/^(.+?)-(PENDING|QUEUED|IN_PROGRESS|DONE|ERROR)\.md$/);
    if (!match) continue;
    const [, , state] = match;

    switch (state) {
      case 'PENDING':     queue.waiting++; break;
      case 'QUEUED':      queue.waiting++; break;
      case 'IN_PROGRESS': queue.active++;  break;
      case 'DONE':        queue.done++;    break;
      case 'ERROR':       queue.error++;   break;
    }

    let fm = {};
    try {
      const content = fs.readFileSync(path.join(QUEUE_DIR, filename), 'utf8');
      fm = parseFrontmatter(content);
    } catch (_) {}

    const id = fm.id ?? match[1];
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
  // Rom — sum DONE events from register.jsonl
  const romRow = { role: 'rom', model: 'claude-sonnet-4-6', count: 0,
                   tokens_in: 0, tokens_out: 0, cost_usd: 0 };
  try {
    const raw = fs.readFileSync(REGISTER, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let ev;
      try { ev = JSON.parse(line); } catch (_) { continue; }
      if (ev.event !== 'DONE') continue;
      romRow.count++;
      romRow.tokens_in  += ev.tokensIn  ?? 0;
      romRow.tokens_out += ev.tokensOut ?? 0;
      romRow.cost_usd   += ev.costUsd   ?? 0;
    }
  } catch (_) { /* register.jsonl absent */ }

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
    try {
      const raw = JSON.parse(fs.readFileSync(HEARTBEAT, 'utf8'));
      const age = raw.ts ? (now - new Date(raw.ts).getTime()) / 1000 : Infinity;
      const status = age < 30 ? 'up' : age < 60 ? 'stale' : 'down';
      const lastActivityAge = raw.last_activity_ts
        ? (now - new Date(raw.last_activity_ts).getTime()) / 1000 : null;
      watcher = {
        status,
        heartbeatAge_s:    Math.round(age),
        currentSlice:      raw.current_slice ?? null,
        elapsedSeconds:    raw.slice_elapsed_seconds ?? null,
        lastActivityAge_s: lastActivityAge != null ? Math.round(lastActivityAge) : null,
        processedTotal:    raw.processed_total ?? 0,
      };
    } catch (_) {}
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

  // ── Unaccept (move PENDING back to staged) ──────────────────────────────────
  const queueUnacceptMatch = pathname.match(/^\/api\/queue\/(\d+)\/unaccept$/);
  if (queueUnacceptMatch && req.method === 'POST') {
    const id = queueUnacceptMatch[1];
    const queuedPath  = path.join(QUEUE_DIR, `${id}-QUEUED.md`);
    const pendingPath = path.join(QUEUE_DIR, `${id}-PENDING.md`);
    const activePath  = fs.existsSync(queuedPath) ? queuedPath : fs.existsSync(pendingPath) ? pendingPath : null;
    if (!activePath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No queued slice ${id}` }));
      return;
    }
    try {
      let content = fs.readFileSync(activePath, 'utf8');
      content = updateFrontmatter(content, { status: 'STAGED' });
      fs.writeFileSync(path.join(STAGED_DIR, `${id}-STAGED.md`), content, 'utf8');
      try { fs.renameSync(activePath, path.join(TRASH_DIR, `${id}-QUEUED.unaccepted`)); } catch (_) {}
      // Remove from queue order
      const order = readQueueOrder();
      const idx = order.indexOf(id);
      if (idx !== -1) order.splice(idx, 1);
      writeQueueOrder(order);
      writeRegisterEvent({ event: 'HUMAN_APPROVAL', slice_id: id, action: 'unaccepted' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
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
    try { data = buildBridgeData(); }
    catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify(data));
    return;
  }

  // ── Cost Center ─────────────────────────────────────────────────────────
  if (pathname === '/api/costs' && req.method === 'GET') {
    try {
      const result = buildCostsData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`LCARS dashboard server running at http://${HOST}:${PORT}`);
});
