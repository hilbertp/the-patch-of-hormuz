'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT       = 4747;
const HOST       = '127.0.0.1';
const REPO_ROOT  = path.resolve(__dirname, '..');
const QUEUE_DIR  = path.join(REPO_ROOT, '.bridge', 'queue');
const HEARTBEAT  = path.join(REPO_ROOT, '.bridge', 'heartbeat.json');
const DASHBOARD  = path.join(__dirname, 'lcars-dashboard.html');

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

// ── Bridge data builder ──────────────────────────────────────────────────────
function buildBridgeData() {
  // Heartbeat
  let heartbeat = { ts: null, status: 'down', current_commission: null,
                    commission_elapsed_seconds: null, processed_total: 0 };
  try {
    const raw = JSON.parse(fs.readFileSync(HEARTBEAT, 'utf8'));
    const age = raw.ts ? (Date.now() - new Date(raw.ts).getTime()) / 1000 : Infinity;
    heartbeat = {
      ts:                        raw.ts   ?? null,
      status:                    age < 60 ? (raw.status ?? 'idle') : 'down',
      current_commission:        raw.current_commission ?? null,
      commission_elapsed_seconds: raw.commission_elapsed_seconds ?? null,
      processed_total:           raw.processed_total ?? 0,
    };
  } catch (_) { /* file missing or malformed → keep defaults */ }

  // Queue files
  let files = [];
  try { files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.md')); }
  catch (_) {}

  const queue = { waiting: 0, active: 0, done: 0, error: 0 };
  const commissions = [];

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

    commissions.push({
      id:        fm.id        ?? match[1],
      title:     fm.title     ?? filename,
      state,
      from:      fm.from      ?? null,
      created:   fm.created   ?? null,
      completed: fm.completed ?? null,
    });
  }

  // Sort by numeric ID descending
  commissions.sort((a, b) => {
    const na = parseInt(a.id, 10);
    const nb = parseInt(b.id, 10);
    if (!isNaN(na) && !isNaN(nb)) return nb - na;
    return b.id.localeCompare(a.id);
  });

  return { heartbeat, queue, commissions };
}

// ── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (pathname === '/' || pathname === '/index.html') {
    fs.readFile(DASHBOARD, (err, data) => {
      if (err) { res.writeHead(500); res.end('Internal Server Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (pathname === '/api/bridge') {
    let data;
    try { data = buildBridgeData(); }
    catch (err) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`LCARS dashboard server running at http://${HOST}:${PORT}`);
});
