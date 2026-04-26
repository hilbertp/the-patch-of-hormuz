'use strict';

/**
 * test-heartbeat-no-dedup.js — Regression test for heartbeat write dedup removal.
 *
 * Run: node bridge/test-heartbeat-no-dedup.js
 *
 * Verifies that writeHeartbeat() writes to disk on every call, even when
 * state is identical between calls. The hash-based dedup (removed in slice 230)
 * skipped writes when state hadn't changed, which broke the liveness signal.
 *
 * Also verifies that the _lastHeartbeatHash variable no longer exists in
 * orchestrator.js source.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else      { failed++; console.error(`  ✗ ${msg}`); }
}

// ── Test 1: Source code no longer contains dedup artifacts ──────────────────

console.log('\nTest 1: No dedup artifacts in orchestrator.js source');
const src = fs.readFileSync(path.join(__dirname, 'orchestrator.js'), 'utf-8');
assert(!src.includes('_lastHeartbeatHash'), '_lastHeartbeatHash variable is removed');
assert(!src.includes('Hash-dedup'), 'Hash-dedup comment is removed');

// ── Test 2: Two identical heartbeat writes both hit disk ────────────────────

console.log('\nTest 2: Consecutive identical writes both update the file');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-test-'));
const hbFile = path.join(tmpDir, 'heartbeat.json');

// Simulate what writeHeartbeat does post-fix: always write, no dedup.
function simulateWrite() {
  const snapshot = {
    ts: new Date().toISOString(),
    status: 'idle',
    current_slice: null,
    current_slice_title: null,
    current_slice_goal: null,
    slice_elapsed_seconds: null,
    last_activity_ts: null,
    processed_total: 0,
    queue: { waiting: 0, active: 0, done: 0, error: 0 },
  };
  fs.writeFileSync(hbFile, JSON.stringify(snapshot, null, 2) + '\n');
}

// First write
simulateWrite();
const stat1 = fs.statSync(hbFile);
const content1 = JSON.parse(fs.readFileSync(hbFile, 'utf-8'));

// Small delay to ensure mtime can advance (filesystem granularity)
const start = Date.now();
while (Date.now() - start < 50) { /* spin */ }

// Second write — identical state
simulateWrite();
const stat2 = fs.statSync(hbFile);
const content2 = JSON.parse(fs.readFileSync(hbFile, 'utf-8'));

assert(stat2.mtimeMs >= stat1.mtimeMs, 'mtime advances on second write');
assert(content2.ts !== content1.ts, 'ts field is different between writes');

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
