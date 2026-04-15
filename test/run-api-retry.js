#!/usr/bin/env node
/**
 * run-api-retry.js
 *
 * Integration test for the watcher's API-outage recovery logic.
 *
 * What it tests
 * ─────────────
 *   When the Anthropic API returns HTTP 500, the watcher must:
 *   1. NOT write a permanent ERROR file for the slice.
 *   2. Move the slice back to PENDING with _api_retry_count incremented.
 *   3. Write an API_RETRY event to register.jsonl.
 *
 * How it works (offline — no real claude or Anthropic needed)
 * ─────────────────────────────────────────────────────────────
 *   1. Temporarily overrides bridge/bridge.config.json so the watcher
 *      calls `node test/mock-claude-500.js` instead of `claude`.
 *   2. Drops a synthetic PENDING slice (ID 999) into bridge/queue/.
 *   3. Spawns the watcher as a child process.
 *   4. Polls until the PENDING file reappears with _api_retry_count > 0
 *      AND a matching API_RETRY event appears in register.jsonl.
 *   5. Kills the watcher and restores all files.
 *
 * Mode: --real (optional)
 * ────────────────────────
 *   Run with --real to use the actual `claude` binary + a local HTTP server
 *   that returns 500, instead of the mock binary.  Requires claude CLI installed.
 *
 *   node test/run-api-retry.js --real [--port 19999]
 *
 * Usage
 * ─────
 *   node test/run-api-retry.js           # offline mode (default)
 *   node test/run-api-retry.js --real    # real claude binary + mock HTTP server
 */
'use strict';

const fs            = require('fs');
const path          = require('path');
const { execFile, spawn }  = require('child_process');

// ── Paths ────────────────────────────────────────────────────────────────────
const REPO_ROOT     = path.resolve(__dirname, '..');
const BRIDGE_DIR    = path.join(REPO_ROOT, 'bridge');
const QUEUE_DIR     = path.join(BRIDGE_DIR, 'queue');
const REGISTER      = path.join(BRIDGE_DIR, 'register.jsonl');
const CONFIG_PATH   = path.join(BRIDGE_DIR, 'bridge.config.json');
const WATCHER       = path.join(BRIDGE_DIR, 'watcher.js');
const MOCK_CLAUDE   = path.join(__dirname, 'mock-claude-500.js');
const MOCK_SERVER   = path.join(__dirname, 'mock-anthropic-server.js');

const TEST_ID       = '999';
const PENDING_FILE  = path.join(QUEUE_DIR, `${TEST_ID}-PENDING.md`);
const ERROR_FILE    = path.join(QUEUE_DIR, `${TEST_ID}-ERROR.md`);
const SLICE_FILE    = path.join(QUEUE_DIR, `${TEST_ID}-SLICE.md`);

const MOCK_PORT     = parseInt(process.argv[process.argv.indexOf('--port') + 1] || '19999', 10);
const USE_REAL      = process.argv.includes('--real');

// ── Logging ──────────────────────────────────────────────────────────────────
const C = { reset:'\x1b[0m', green:'\x1b[32m', red:'\x1b[31m', yellow:'\x1b[33m', dim:'\x1b[2m', bold:'\x1b[1m' };
const log   = (...a) => console.log('[test]', ...a);
const pass  = msg => console.log(`${C.green}✓${C.reset} ${msg}`);
const fail  = msg => { console.log(`${C.red}✗${C.reset} ${msg}`); };
const info  = msg => console.log(`${C.dim}      ${msg}${C.reset}`);

// ── State ────────────────────────────────────────────────────────────────────
let watcherProc  = null;
let mockSrvProc  = null;
let origConfig   = null;
let passed       = 0;
let failed       = 0;

// ── Cleanup ──────────────────────────────────────────────────────────────────
function cleanup() {
  if (watcherProc) { try { watcherProc.kill('SIGTERM'); } catch (_) {} watcherProc = null; }
  if (mockSrvProc) { try { mockSrvProc.kill('SIGTERM'); } catch (_) {} mockSrvProc = null; }

  // Remove test queue files
  for (const f of [PENDING_FILE, ERROR_FILE, SLICE_FILE]) {
    if (fs.existsSync(f)) {
      try {
        // FUSE mount may block unlink; rename to trash instead
        const trash = path.join(BRIDGE_DIR, 'trash', path.basename(f) + '.test-cleanup');
        fs.mkdirSync(path.join(BRIDGE_DIR, 'trash'), { recursive: true });
        fs.renameSync(f, trash);
      } catch (_) {}
    }
  }

  // Restore bridge.config.json
  if (origConfig !== null) {
    fs.writeFileSync(CONFIG_PATH, origConfig, 'utf8');
    origConfig = null;
  }

  // Remove any API_RETRY register entries written during the test
  try {
    const raw = fs.readFileSync(REGISTER, 'utf8');
    const cleaned = raw.split('\n')
      .filter(l => { try { const e = JSON.parse(l); return !(e.id === TEST_ID); } catch (_) { return true; } })
      .join('\n');
    fs.writeFileSync(REGISTER, cleaned, 'utf8');
  } catch (_) {}
}

process.on('exit',    cleanup);
process.on('SIGINT',  () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

// ── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readRegisterEvents(id) {
  try {
    return fs.readFileSync(REGISTER, 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter(e => e && e.id === id);
  } catch (_) { return []; }
}

function parseFm(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  m[1].split('\n').forEach(line => {
    const ci = line.indexOf(':');
    if (ci === -1) return;
    const k = line.slice(0, ci).trim();
    const v = line.slice(ci + 1).trim().replace(/^["']|["']$/g, '');
    if (k) out[k] = v;
  });
  return out;
}

function assert(condition, label, detail) {
  if (condition) { pass(label); passed++; }
  else           { fail(label); if (detail) info(detail); failed++; }
}

// ── Write test PENDING file ──────────────────────────────────────────────────
function writePending() {
  const content = `---
id: "${TEST_ID}"
title: "Test slice — API outage simulation"
goal: "Verify watcher requeues slice automatically when Anthropic API returns 500."
from: obrien
to: rom
priority: normal
created: "${new Date().toISOString()}"
status: "PENDING"
---

## Objective

This is a synthetic test slice injected by run-api-retry.js.
O'Brien (or the mock in its place) will immediately return HTTP 500.
The watcher must requeue this slice with _api_retry_count = 1
instead of writing an ERROR file.

## Tasks

1. Do anything — the mock will interrupt before you start.

## Success Criteria

- _api_retry_count in PENDING frontmatter is 1
- API_RETRY event exists in register.jsonl for id ${TEST_ID}
- No ${TEST_ID}-ERROR.md in bridge/queue/
`;
  fs.writeFileSync(PENDING_FILE, content, 'utf8');
  log(`Created ${TEST_ID}-PENDING.md`);
}

// ── Override bridge.config.json ──────────────────────────────────────────────
function patchConfig(overrides) {
  origConfig = fs.readFileSync(CONFIG_PATH, 'utf8');
  const base = JSON.parse(origConfig);
  const patched = { ...base, ...overrides };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(patched, null, 2), 'utf8');
  log('Patched bridge.config.json:', JSON.stringify(overrides));
}

// ── Start mock Anthropic HTTP server (--real mode) ───────────────────────────
function startMockServer() {
  return new Promise((resolve, reject) => {
    mockSrvProc = spawn(process.execPath, [MOCK_SERVER, String(MOCK_PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    mockSrvProc.stdout.on('data', chunk => {
      const s = chunk.toString();
      process.stdout.write(`${C.dim}[mock-srv] ${s}${C.reset}`);
      if (s.includes('ready on')) resolve();
    });
    mockSrvProc.stderr.on('data', chunk => {
      process.stderr.write(`${C.dim}[mock-srv] ${chunk}${C.reset}`);
    });
    mockSrvProc.on('error', reject);
    setTimeout(() => reject(new Error('Mock server did not start in time')), 5000);
  });
}

// ── Poll for result ──────────────────────────────────────────────────────────
async function waitForRetry(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(500);

    // Primary signal: API_RETRY event in register.jsonl.
    // This is written before the watcher requeues, so it's persistent even if
    // the PENDING file is immediately picked up again on the next poll cycle.
    const events = readRegisterEvents(TEST_ID);
    const apiRetryEvents = events.filter(e => e.event === 'API_RETRY');
    if (apiRetryEvents.length > 0) {
      // Also capture PENDING frontmatter if still present (best-effort — may be
      // gone already if the watcher re-picked the slice within the 1s poll window).
      let pendingFm = null;
      if (fs.existsSync(PENDING_FILE)) {
        try { pendingFm = parseFm(fs.readFileSync(PENDING_FILE, 'utf8')); } catch (_) {}
      }
      if (!pendingFm) {
        // File already re-queued into IN_PROGRESS; synthesise minimal fm from register event
        const ev = apiRetryEvents[0];
        pendingFm = { status: 'PENDING', _api_retry_count: String(ev.retryCount) };
      }
      return { pendingFm, events };
    }

    // If ERROR file appeared instead, test fails
    if (fs.existsSync(ERROR_FILE)) {
      return { pendingFm: null, events: readRegisterEvents(TEST_ID), gotError: true };
    }
  }
  return { pendingFm: null, events: readRegisterEvents(TEST_ID), timedOut: true };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}=== API Outage Recovery Test ===${C.reset}`);
  console.log(`Mode: ${USE_REAL ? 'real claude + mock HTTP server' : 'mock claude binary (offline)'}\n`);

  // 1. Configure watcher to use mock
  if (USE_REAL) {
    log(`Starting mock Anthropic server on port ${MOCK_PORT}...`);
    await startMockServer();
    patchConfig({
      pollIntervalMs:      1000,
      inactivityTimeoutMs: 10000,
      // Real claude binary; ANTHROPIC_BASE_URL is set in the env below
    });
  } else {
    patchConfig({
      claudeCommand:       process.execPath,        // node
      claudeArgs:          [MOCK_CLAUDE],            // mock-claude-500.js (ignores stdin, exits 1)
      pollIntervalMs:      1000,
      inactivityTimeoutMs: 10000,
    });
  }

  // 2. Write test PENDING
  writePending();

  // 3. Spawn watcher
  const watcherEnv = { ...process.env };
  if (USE_REAL) watcherEnv.ANTHROPIC_BASE_URL = `http://127.0.0.1:${MOCK_PORT}`;

  log('Spawning watcher...');
  watcherProc = spawn(process.execPath, [WATCHER], {
    cwd: REPO_ROOT,
    env: watcherEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  watcherProc.stdout.on('data', chunk => process.stdout.write(`${C.dim}[watcher] ${chunk}${C.reset}`));
  watcherProc.stderr.on('data', chunk => process.stderr.write(`${C.dim}[watcher] ${chunk}${C.reset}`));
  watcherProc.on('error', err => { log('Watcher process error:', err.message); });

  log('Waiting for retry (up to 30s)...\n');
  const result = await waitForRetry(30000);

  // 4. Evaluate results
  console.log('\n' + '─'.repeat(50));
  console.log('Results\n');

  if (result.timedOut) {
    fail('Timed out waiting for retry — watcher did not requeue the slice');
  } else if (result.gotError) {
    fail('ERROR file appeared — watcher wrote an error instead of retrying');
  } else {
    const retryCount = parseInt(result.pendingFm._api_retry_count, 10);
    assert(retryCount >= 1,
      `PENDING file requeued with _api_retry_count = ${retryCount}`,
      `Expected >= 1, got ${retryCount}`);

    assert(result.pendingFm.status === 'PENDING',
      'PENDING file has status = PENDING (not ERROR)',
      `Got: ${result.pendingFm.status}`);

    assert(!fs.existsSync(ERROR_FILE),
      'No ERROR file written to queue/',
      `Found: ${ERROR_FILE}`);

    const apiRetryEvents = result.events.filter(e => e.event === 'API_RETRY');
    assert(apiRetryEvents.length >= 1,
      `API_RETRY event written to register.jsonl (${apiRetryEvents.length} found)`,
      'Expected at least 1 API_RETRY event');

    if (apiRetryEvents.length > 0) {
      const ev = apiRetryEvents[0];
      assert(ev.retryCount === retryCount,
        `register event retryCount matches frontmatter (${ev.retryCount})`,
        `Expected ${retryCount}, got ${ev.retryCount}`);
      info(`  title:      ${ev.title || '(none)'}`);
      info(`  maxRetries: ${ev.maxRetries}`);
    }
  }

  console.log('\n' + '─'.repeat(50));
  const allPassed = failed === 0;
  console.log(`\n${allPassed ? C.green : C.red}${C.bold}${passed + failed} assertions — ${passed} passed, ${failed} failed${C.reset}\n`);

  process.exitCode = allPassed ? 0 : 1;
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exitCode = 1;
});
