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

const CORS_ORIGIN  = 'https://dax-dashboard.lovable.app';

const QUEUE_ORDER  = path.join(REPO_ROOT, 'bridge', 'queue-order.json');

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

// ── Register reader ──────────────────────────────────────────────────────────
function readRegister() {
  try {
    const raw = fs.readFileSync(REGISTER, 'utf8');
    return raw.split('\n').filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) { return []; }
}

// ── Register writer ──────────────────────────────────────────────────────────
function writeRegisterEvent(event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
  fs.appendFileSync(REGISTER, line, 'utf8');
}

// ── Title/goal fallback ─────────────────────────────────────────────────────
// First try the COMMISSIONED register event, then fall back to {id}-SLICE.md.
function getTitleAndGoal(id, commissioned) {
  if (commissioned[id]?.title) {
    return { title: commissioned[id].title, goal: commissioned[id].goal ?? null };
  }
  try {
    const slicePath = path.join(QUEUE_DIR, `${id}-SLICE.md`);
    const content = fs.readFileSync(slicePath, 'utf8');
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
    // REVIEW_RECEIVED carries the verdict; REVIEWED is the legacy name
    if (ev.event === 'REVIEW_RECEIVED' || ev.event === 'REVIEWED') {
      reviewedMap[ev.id] = ev.verdict;
    }
    // ACCEPTED after an ERROR means Philipp overrode the watcher (approve|slice|amend|reject|update-body)ion
    if (ev.event === 'ACCEPTED' || ev.event === 'MERGED') {
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
      else if (verdict === 'AMENDMENT_REQUIRED') reviewStatus = '(approve|slice|amend|reject|update-body)ment_required';
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
    const match = filename.match(/^(.+?)-(PENDING|IN_PROGRESS|DONE|ERROR)\.md$/);
    if (!match) continue;
    const [, , state] = match;

    switch (state) {
      case 'PENDING':     queue.waiting++; break;
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

  // Nog active state (slice 105)
  let nogActive = null;
  try {
    const raw = JSON.parse(fs.readFileSync(NOG_ACTIVE, 'utf8'));
    if (raw && raw.sliceId) nogActive = raw;
  } catch (_) {}

  return { heartbeat, queue, slices, recent, economics, queueOrder, nogActive, apiRetries };
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
      const VALID_VERDICTS = ['ACCEPTED', 'AMENDMENT_NEEDED', 'STUCK'];
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

      try {
        writeRegisterEvent(Object.assign(
          { id: String(id), event: 'REVIEW_RECEIVED', verdict },
          reason ? { reason } : {}
        ));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'Failed to write register entry' }));
        return;
      }

      res.writeHead(201, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── Staged slice endpoints ──────────────────────────────────────────────
  if (pathname === '/api/bridge/staged' && req.method === 'GET') {
    let files = [];
    try { files = fs.readdirSync(STAGED_DIR).filter(f => f.endsWith('-STAGED.md') || f.endsWith('-NEEDS_AMENDMENT.md')); }
    catch (_) {}

    const items = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(STAGED_DIR, file), 'utf8');
        const fm = parseFrontmatter(content);
        const body = extractBody(content);
        const status = file.endsWith('-NEEDS_AMENDMENT.md') ? 'NEEDS_AMENDMENT' : (fm.status || 'STAGED');
        const itemId = fm.id ?? file.replace(/-(STAGED|NEEDS_AMENDMENT)\.md$/, '');
        items.push({
          id:              itemId,
          title:           fm.title ?? null,
          summary:         fm.summary ?? null,
          goal:            fm.goal ?? null,
          status,
          amendment_note:  fm.amendment_note ?? null,
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

    // Find the staged file (could be STAGED or NEEDS_AMENDMENT)
    const stagedPath    = path.join(STAGED_DIR, `${id}-STAGED.md`);
    const amendmentPath = path.join(STAGED_DIR, `${id}-NEEDS_AMENDMENT.md`);
    const filePath = fs.existsSync(stagedPath) ? stagedPath
                   : fs.existsSync(amendmentPath) ? amendmentPath
                   : null;

    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Staged slice ${id} not found` }));
      return;
    }

    if (action === 'approve' || action === 'slice') {
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        content = updateFrontmatter(content, { status: 'PENDING' });
        fs.writeFileSync(path.join(QUEUE_DIR, `${id}-PENDING.md`), content, 'utf8');
        try { fs.renameSync(filePath, path.join(TRASH_DIR, path.basename(filePath) + '.approved')); } catch (_) {}
        // Add to queue order (amendments go to front, others to end)
        const order = readQueueOrder();
        const fm2 = parseFrontmatter(content);
        if (fm2.references && fm2.references !== 'null') {
          // Amendment: insert at front
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
        content = updateFrontmatter(content, { status: 'NEEDS_AMENDMENT', amendment_note: payload.note });
        // Rename to NEEDS_AMENDMENT if currently STAGED
        const destPath = path.join(STAGED_DIR, `${id}-NEEDS_AMENDMENT.md`);
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ watcher, wormhole }));
    return;
  }

  // ── Queue slice content (for slice detail overlay) ─────────────────────────
  const queueContentMatch = pathname.match(/^\/api\/queue\/(\d+)\/content$/);
  if (queueContentMatch && req.method === 'GET') {
    const id = queueContentMatch[1];
    // SLICE.md is the original prompt given to O'Brien — show it first.
    // Fall back to PENDING (same content, still in queue) then STAGED, then DONE report.
    const candidates = [
      path.join(QUEUE_DIR, `${id}-SLICE.md`),
      path.join(QUEUE_DIR, `${id}-PENDING.md`),
      path.join(STAGED_DIR, `${id}-STAGED.md`),
      path.join(STAGED_DIR, `${id}-NEEDS_AMENDMENT.md`),
      path.join(QUEUE_DIR, `${id}-ACCEPTED.md`),
      path.join(QUEUE_DIR, `${id}-BRIEF.md`),
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
    const pendingPath = path.join(QUEUE_DIR, `${id}-PENDING.md`);
    if (!fs.existsSync(pendingPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No pending slice ${id}` }));
      return;
    }
    try {
      let content = fs.readFileSync(pendingPath, 'utf8');
      content = updateFrontmatter(content, { status: 'STAGED' });
      fs.writeFileSync(path.join(STAGED_DIR, `${id}-STAGED.md`), content, 'utf8');
      try { fs.renameSync(pendingPath, path.join(TRASH_DIR, `${id}-PENDING.unaccepted`)); } catch (_) {}
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

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`LCARS dashboard server running at http://${HOST}:${PORT}`);
});
