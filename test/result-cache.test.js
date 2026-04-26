'use strict';

/**
 * result-cache.test.js
 *
 * Regression tests for slice 225 — result-level caching of buildBridgeData
 * and buildCostsData:
 *   A. getCachedBridgeData returns same object on second call (cache hit)
 *   B. getCachedBridgeData recomputes after register.jsonl write
 *   C. getCachedBridgeData recomputes after heartbeat.json write
 *   D. getCachedCostsData returns same object on second call (cache hit)
 *   E. getCachedCostsData recomputes after register.jsonl write
 *
 * Run: node test/result-cache.test.js
 */

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const assert = require('assert');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${err.message}`);
  }
}

console.log('\nresult-cache.test.js — slice 225 regression tests\n');

// ── Setup: temp directory mimicking repo structure ──────────────────────────

const tmpRoot    = fs.mkdtempSync(path.join(os.tmpdir(), 'result-cache-'));
const bridgeDir  = path.join(tmpRoot, 'bridge');
const queueDir   = path.join(bridgeDir, 'queue');
const stagedDir  = path.join(bridgeDir, 'staged');
const trashDir   = path.join(bridgeDir, 'trash');
const controlDir = path.join(bridgeDir, 'control');
const errorsDir  = path.join(bridgeDir, 'errors');
const dashDir    = path.join(tmpRoot, 'dashboard');

for (const d of [bridgeDir, queueDir, stagedDir, trashDir, controlDir, errorsDir, dashDir]) {
  fs.mkdirSync(d, { recursive: true });
}

// Minimal heartbeat
const hbPath = path.join(bridgeDir, 'heartbeat.json');
fs.writeFileSync(hbPath, JSON.stringify({ ts: new Date().toISOString(), status: 'idle' }));

// Minimal register with one DONE event
const regPath = path.join(bridgeDir, 'register.jsonl');
fs.writeFileSync(regPath, JSON.stringify({
  ts: new Date().toISOString(), event: 'DONE', id: '001',
  tokensIn: 100, tokensOut: 50, costUsd: 0.01, durationMs: 5000,
}) + '\n');

// Sessions file
const sessPath = path.join(bridgeDir, 'sessions.jsonl');
fs.writeFileSync(sessPath, '');

// Empty files the server expects
fs.writeFileSync(path.join(bridgeDir, 'first-output.json'), '{}');
fs.writeFileSync(path.join(bridgeDir, 'nog-active.json'), '{}');
fs.writeFileSync(path.join(bridgeDir, 'queue-order.json'), '[]');
fs.writeFileSync(path.join(bridgeDir, 'staged-order.json'), '[]');

// Lifecycle-translate shim (the real one would fail without proper setup)
const ltPath = path.join(bridgeDir, 'lifecycle-translate.js');
fs.writeFileSync(ltPath, `
  'use strict';
  let callCount = 0;
  module.exports = {
    translateEvent(ev) { callCount++; return ev; },
    resetDedupeState() {},
    getTranslateCallCount() { return callCount; },
    resetTranslateCallCount() { callCount = 0; },
  };
`);

// Minimal dashboard HTML (server reads it on /)
fs.writeFileSync(path.join(dashDir, 'lcars-dashboard.html'), '<html></html>');

// Patch environment so require() of server.js uses our temp paths
// We do this by patching the module's constants after require.
// Instead, we'll directly test via a child process approach — but simpler:
// just override the module-level constants by re-reading after patching __dirname.

// Actually the simplest approach: require the server module and patch its internal
// paths. The module uses `path.resolve(__dirname, '..')` for REPO_ROOT. We can't
// change __dirname after load. Instead, create a small wrapper that redefines the
// constants and re-evaluates the key functions.

// Approach: read server.js source, replace REPO_ROOT, eval in a sandboxed context.
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'server.js'), 'utf8');

// Build a module from the source with patched paths
const patchedSrc = serverSrc
  .replace(
    /const REPO_ROOT\s*=\s*path\.resolve\(__dirname,\s*'\.\.'\);/,
    `const REPO_ROOT = ${JSON.stringify(tmpRoot)};`
  )
  .replace(
    /const DASHBOARD\s*=\s*path\.join\(__dirname,\s*'lcars-dashboard\.html'\);/,
    `const DASHBOARD = ${JSON.stringify(path.join(dashDir, 'lcars-dashboard.html'))};`
  )
  // Don't start the server
  .replace(/if \(require\.main === module\)/, 'if (false)')
  // Replace lifecycle-translate require to use our shim
  .replace(
    /require\(path\.join\(REPO_ROOT,\s*'bridge',\s*'lifecycle-translate'\)\)/,
    `require(${JSON.stringify(ltPath)})`
  );

// Evaluate in a fresh module context
const Module = require('module');
const m = new Module('patched-server');
m.paths = module.paths;
m._compile(patchedSrc, path.join(dashDir, 'server.js'));
const srv = m.exports;

// Get the lifecycle-translate shim for call counting
const ltShim = require(ltPath);

// ── Tests ───────────────────────────────────────────────────────────────────

test('A. getCachedBridgeData returns same object on second call (cache hit)', () => {
  // Clear any stale cache state
  for (const k of Object.keys(srv._cache)) delete srv._cache[k];
  ltShim.resetTranslateCallCount();

  const r1 = srv.getCachedBridgeData();
  const countAfterFirst = ltShim.getTranslateCallCount();
  assert.ok(countAfterFirst > 0, 'translateEvent called on first invocation');

  ltShim.resetTranslateCallCount();
  const r2 = srv.getCachedBridgeData();
  const countAfterSecond = ltShim.getTranslateCallCount();

  assert.strictEqual(r1, r2, 'Second call returns exact same object reference');
  assert.strictEqual(countAfterSecond, 0, 'translateEvent NOT called on cache hit');
});

test('B. getCachedBridgeData recomputes after register.jsonl write', () => {
  for (const k of Object.keys(srv._cache)) delete srv._cache[k];
  const r1 = srv.getCachedBridgeData();

  // Append a new event to register and bump mtime
  const stat = fs.statSync(regPath);
  const newMtime = new Date(stat.mtimeMs + 1000);
  fs.appendFileSync(regPath, JSON.stringify({
    ts: new Date().toISOString(), event: 'DONE', id: '002',
    tokensIn: 200, tokensOut: 100, costUsd: 0.02, durationMs: 3000,
  }) + '\n');
  fs.utimesSync(regPath, newMtime, newMtime);

  ltShim.resetTranslateCallCount();
  const r2 = srv.getCachedBridgeData();

  assert.notStrictEqual(r1, r2, 'Returns new object after register change');
  assert.ok(ltShim.getTranslateCallCount() > 0, 'translateEvent called on cache miss');
});

test('C. getCachedBridgeData recomputes after heartbeat.json write', () => {
  for (const k of Object.keys(srv._cache)) delete srv._cache[k];
  const r1 = srv.getCachedBridgeData();

  // Update heartbeat and bump mtime
  const stat = fs.statSync(hbPath);
  const newMtime = new Date(stat.mtimeMs + 1000);
  fs.writeFileSync(hbPath, JSON.stringify({ ts: new Date().toISOString(), status: 'busy' }));
  fs.utimesSync(hbPath, newMtime, newMtime);

  const r2 = srv.getCachedBridgeData();
  assert.notStrictEqual(r1, r2, 'Returns new object after heartbeat change');
});

test('D. getCachedCostsData returns same object on second call (cache hit)', () => {
  for (const k of Object.keys(srv._cache)) delete srv._cache[k];
  const r1 = srv.getCachedCostsData();
  const r2 = srv.getCachedCostsData();
  assert.strictEqual(r1, r2, 'Second call returns exact same object reference');
});

test('E. getCachedCostsData recomputes after register.jsonl write', () => {
  for (const k of Object.keys(srv._cache)) delete srv._cache[k];
  const r1 = srv.getCachedCostsData();

  const stat = fs.statSync(regPath);
  const newMtime = new Date(stat.mtimeMs + 1000);
  fs.appendFileSync(regPath, JSON.stringify({
    ts: new Date().toISOString(), event: 'DONE', id: '003',
    tokensIn: 300, tokensOut: 150, costUsd: 0.03, durationMs: 2000,
  }) + '\n');
  fs.utimesSync(regPath, newMtime, newMtime);

  const r2 = srv.getCachedCostsData();
  assert.notStrictEqual(r1, r2, 'Returns new object after register change');
});

// ── Cleanup ─────────────────────────────────────────────────────────────────

fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
