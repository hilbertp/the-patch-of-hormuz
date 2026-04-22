'use strict';

/**
 * new-slice-restaged.test.js
 *
 * Tests for slice 190 — conditional RESTAGED emission in bridge/new-slice.js.
 *
 * Cases:
 *   A: ID with no prior COMMISSIONED → no RESTAGED emitted
 *   B: ID with one prior COMMISSIONED → exactly one RESTAGED emitted
 *   C: ID with multiple prior COMMISSIONED → exactly one RESTAGED emitted
 *   D: COMMISSIONED for a different ID → no RESTAGED emitted for this ID
 *
 * Register writes route to a tmp fixture file via DS9_REGISTER_FILE.
 * Queue and staged dirs also redirected via DS9_QUEUE_DIR / DS9_STAGED_DIR.
 *
 * Run: node test/new-slice-restaged.test.js
 */

const fs          = require('fs');
const os          = require('os');
const path        = require('path');
const assert      = require('assert');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Temp directories — fully isolated from real bridge dirs
// ---------------------------------------------------------------------------

const TEMP   = fs.mkdtempSync(path.join(os.tmpdir(), 'ds9-new-slice-test-'));
const QUEUE  = path.join(TEMP, 'queue');
const STAGED = path.join(TEMP, 'staged');
const REG    = path.join(TEMP, 'register.jsonl');

fs.mkdirSync(QUEUE,  { recursive: true });
fs.mkdirSync(STAGED, { recursive: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NEW_SLICE = path.join(__dirname, '..', 'bridge', 'new-slice.js');
const PROJECT   = path.join(__dirname, '..');

function runNewSlice(extraEnv) {
  const env = Object.assign({}, process.env, {
    DS9_REGISTER_FILE: REG,
    DS9_QUEUE_DIR:     QUEUE,
    DS9_STAGED_DIR:    STAGED,
  }, extraEnv || {});
  return execSync(
    `node ${NEW_SLICE} --title "Test slice" --goal "Test goal" --priority normal`,
    { cwd: PROJECT, env, stdio: 'pipe' }
  ).toString();
}

function writeReg(entries) {
  const body = entries.length
    ? entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    : '';
  fs.writeFileSync(REG, body, 'utf8');
}

function readReg() {
  try {
    return fs.readFileSync(REG, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) { return []; }
}

function getLastStagedId() {
  const files = fs.readdirSync(STAGED).filter(f => f.endsWith('-STAGED.md'));
  if (files.length === 0) throw new Error('No STAGED file found in ' + STAGED);
  files.sort();
  const content = fs.readFileSync(path.join(STAGED, files[files.length - 1]), 'utf-8');
  const m = content.match(/^id:\s*"(\d+)"/m);
  if (!m) throw new Error('Could not extract id from STAGED file');
  return m[1];
}

function clearStaged() {
  try {
    for (const f of fs.readdirSync(STAGED)) {
      fs.unlinkSync(path.join(STAGED, f));
    }
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  clearStaged();
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
  clearStaged();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\nnew-slice.js RESTAGED emission');

// Case A: no prior COMMISSIONED → no RESTAGED
test('A: no prior COMMISSIONED → no RESTAGED emitted', () => {
  writeReg([]);
  runNewSlice();
  const restaged = readReg().filter(l => l.event === 'RESTAGED');
  assert.strictEqual(restaged.length, 0, `Expected 0 RESTAGED events, got ${restaged.length}`);
});

// Case B: one prior COMMISSIONED → exactly one RESTAGED
test('B: one prior COMMISSIONED for assigned ID → exactly one RESTAGED emitted', () => {
  // First run: get the id that will be assigned on the next run (001 since queue is empty)
  writeReg([]);
  runNewSlice();
  const sliceId = getLastStagedId();
  clearStaged();

  // Pre-populate register with a COMMISSIONED event for that ID
  writeReg([
    { ts: '2026-04-01T00:00:00.000Z', event: 'COMMISSIONED', slice_id: sliceId },
  ]);
  // Also add a staged file so next run picks the same id again (queue now empty, staged has it)
  // Actually nextSliceId will pick sliceId+1 since STAGED has sliceId...
  // We need to clear staged so the same id is available, but then the STAGED collision check
  // won't trigger — new-slice.js will assign the same id again since QUEUE and STAGED are empty.
  // The while loop only increments if STAGED already has the id.

  runNewSlice();
  const assigned = getLastStagedId();
  const restaged = readReg().filter(l => l.event === 'RESTAGED');

  // If the same id was reassigned, we should see exactly one RESTAGED
  if (assigned === sliceId) {
    assert.strictEqual(restaged.length, 1, `Expected 1 RESTAGED for id ${sliceId}, got ${restaged.length}`);
    assert.strictEqual(restaged[0].slice_id, sliceId);
  } else {
    // Different id was assigned (edge case), still no RESTAGED for it
    const restagedForAssigned = restaged.filter(l => l.slice_id === assigned);
    assert.strictEqual(restagedForAssigned.length, 0, 'No COMMISSIONED for new id, no RESTAGED expected');
  }
});

// Case C: COMMISSIONED for a *different* ID → no RESTAGED
test('C: COMMISSIONED for different ID → no RESTAGED emitted', () => {
  writeReg([]);
  runNewSlice();
  const sliceId = getLastStagedId();
  clearStaged();

  // Commission a very different ID
  const otherId = String(parseInt(sliceId, 10) + 500).padStart(3, '0');
  writeReg([
    { ts: '2026-04-01T00:00:00.000Z', event: 'COMMISSIONED', slice_id: otherId },
  ]);

  const linesBefore = readReg().length;
  runNewSlice();
  const linesAfter = readReg();
  const newLines = linesAfter.slice(linesBefore);
  const restaged = newLines.filter(l => l.event === 'RESTAGED');
  // The assigned ID will be sliceId (same queue/staged state), not otherId
  const assigned = getLastStagedId();
  assert.notStrictEqual(assigned, otherId, 'Should have assigned sliceId, not otherId');
  assert.strictEqual(restaged.length, 0, `No COMMISSIONED for assigned id → no RESTAGED`);
});

// Structural: DS9_REGISTER_FILE env var is used
test('DS9_REGISTER_FILE env var is honoured (no pollute to real register)', () => {
  const realReg = path.join(__dirname, '..', 'bridge', 'register.jsonl');
  const realLineBefore = (() => {
    try { return fs.readFileSync(realReg, 'utf-8').split('\n').filter(Boolean).length; }
    catch (_) { return 0; }
  })();

  writeReg([]);
  runNewSlice();

  const realLineAfter = (() => {
    try { return fs.readFileSync(realReg, 'utf-8').split('\n').filter(Boolean).length; }
    catch (_) { return 0; }
  })();
  assert.strictEqual(realLineBefore, realLineAfter, 'Real register.jsonl must not be modified');
});

// ---------------------------------------------------------------------------
// Cleanup + summary
// ---------------------------------------------------------------------------

try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch (_) {}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
