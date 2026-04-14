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

const CORS_ORIGIN  = 'https://dax-dashboard.lovable.app';

// ── Ensure staging directories exist ─────────────────────────────────────────
for (const dir of [STAGED_DIR, TRASH_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
// First try the COMMISSIONED register event, then fall back to {id}-BRIEF.md.
function getTitleAndGoal(id, commissioned) {
  if (commissioned[id]?.title) {
    return { title: commissioned[id].title, goal: commissioned[id].goal ?? null };
  }
  try {
    const briefPath = path.join(QUEUE_DIR, `${id}-BRIEF.md`);
    const content = fs.readFileSync(briefPath, 'utf8');
    const fm = parseFrontmatter(content);
    return { title: fm.title ?? null, goal: fm.goal ?? null };
  } catch (_) {
    return { title: null, goal: null };
  }
}

// ── Bridge data builder ──────────────────────────────────────────────────────
function buildBridgeData() {
  // Heartbeat
  let heartbeat = { ts: null, status: 'down', current_brief: null,
                    brief_elapsed_seconds: null, processed_total: 0 };
  try {
    const raw = JSON.parse(fs.readFileSync(HEARTBEAT, 'utf8'));
    const age = raw.ts ? (Date.now() - new Date(raw.ts).getTime()) / 1000 : Infinity;
    heartbeat = {
      ts:                        raw.ts   ?? null,
      status:                    age < 60 ? (raw.status ?? 'idle') : 'down',
      current_brief:             raw.current_brief ?? null,
      brief_elapsed_seconds:     raw.brief_elapsed_seconds ?? null,
      processed_total:           raw.processed_total ?? 0,
    };
  } catch (_) { /* file missing or malformed → keep defaults */ }

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
  const economics = { totalTokensIn: 0, totalTokensOut: 0, totalCostUsd: 0, totalBriefs: 0 };
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
        economics.totalBriefs++;
      }
    }
    // REVIEW_RECEIVED carries the verdict; REVIEWED is the legacy name
    if (ev.event === 'REVIEW_RECEIVED' || ev.event === 'REVIEWED') {
      reviewedMap[ev.id] = ev.verdict;
    }
    // ACCEPTED after an ERROR means Philipp overrode the watcher rejection
    if (ev.event === 'ACCEPTED' || ev.event === 'MERGED') {
      acceptedSet.add(ev.id);
    }
  }
  const recent = Object.values(completedMap)
    .sort((a, b) => {
      if (!a.completedAt) return 1;
      if (!b.completedAt) return -1;
      return new Date(b.completedAt) - new Date(a.completedAt);
    })
    .slice(0, 10)
    .map(entry => {
      const verdict = reviewedMap[entry.id];
      // If watcher errored but Philipp accepted it, show final outcome as ACCEPTED
      const finalOutcome = (entry.outcome === 'ERROR' && acceptedSet.has(entry.id))
        ? 'ACCEPTED' : entry.outcome;
      let reviewStatus;
      if (verdict === 'ACCEPTED')                reviewStatus = 'accepted';
      else if (verdict === 'AMENDMENT_REQUIRED') reviewStatus = 'amendment_required';
      else if (acceptedSet.has(entry.id))        reviewStatus = 'accepted';
      else                                       reviewStatus = 'waiting_for_review';
      return { ...entry, outcome: finalOutcome, reviewStatus };
    });

  // Queue files
  let files = [];
  try { files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.md')); }
  catch (_) {}

  const queue = { waiting: 0, active: 0, done: 0, error: 0 };
  const briefs = [];

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

    briefs.push({
      id,
      title:     fm.title     ?? filename,
      state,
      from:      fm.from      ?? null,
      created:   fm.created   ?? null,
      completed: fm.completed ?? null,
      goal:      goalFromRegister ?? goalFromFm,
    });
  }

  // Sort by numeric ID descending
  briefs.sort((a, b) => {
    const na = parseInt(a.id, 10);
    const nb = parseInt(b.id, 10);
    if (!isNaN(na) && !isNaN(nb)) return nb - na;
    return b.id.localeCompare(a.id);
  });

  return { heartbeat, queue, briefs, recent, economics };
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

  // ── Staged brief endpoints ──────────────────────────────────────────────
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
        items.push({
          id:              fm.id ?? file.replace(/-(STAGED|NEEDS_AMENDMENT)\.md$/, ''),
          title:           fm.title ?? null,
          summary:         fm.summary ?? null,
          goal:            fm.goal ?? null,
          status,
          amendment_note:  fm.amendment_note ?? null,
          body,
        });
      } catch (_) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(items));
    return;
  }

  const stagedMatch = pathname.match(/^\/api\/bridge\/staged\/(\d+)\/(approve|brief|amend|reject|update-body)$/);
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
      res.end(JSON.stringify({ error: `Staged brief ${id} not found` }));
      return;
    }

    if (action === 'approve' || action === 'brief') {
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        content = updateFrontmatter(content, { status: 'PENDING' });
        fs.writeFileSync(path.join(QUEUE_DIR, `${id}-PENDING.md`), content, 'utf8');
        fs.unlinkSync(filePath);
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
        if (filePath !== destPath) fs.unlinkSync(filePath);
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
        fs.writeFileSync(path.join(TRASH_DIR, `${id}-REJECTED.md`), content, 'utf8');
        fs.unlinkSync(filePath);
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
