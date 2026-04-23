'use strict';

/**
 * bootstrap-rescue.test.js
 *
 * Tests for slice 190 — one-shot bootstrap rescue in orchestrator.js.
 *
 * Cases:
 *   1. DONE file present, register has stale NOG_DECISION, no RESTAGED →
 *      bootstrap appends one RESTAGED and writes marker file
 *   2. Second bootstrap run with marker present → no-op (idempotent)
 *   3. DONE file present but register already has RESTAGED → no extra RESTAGED appended
 *   4. DONE file present but register has no review event → no RESTAGED appended
 *   5. No DONE files → marker written, register unchanged
 *   6. Multiple wedged DONE files → one RESTAGED per wedged id
 *
 * Run: node test/bootstrap-rescue.test.js
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const assert = require('assert');

const { restagedBootstrap } = require('../bridge/orchestrator.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ds9-bootstrap-test-'));
}

function setup() {
  const TEMP       = makeTmpDir();
  const QUEUE      = path.join(TEMP, 'queue');
  const REG        = path.join(TEMP, 'register.jsonl');
  const MARKER     = path.join(TEMP, 'bootstrap-done');
  fs.mkdirSync(QUEUE, { recursive: true });
  return { TEMP, QUEUE, REG, MARKER };
}

function writeReg(regFile, entries) {
  fs.writeFileSync(regFile, entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''), 'utf8');
}

function readReg(regFile) {
  try {
    return fs.readFileSync(regFile, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) { return []; }
}

function writeDone(queueDir, id) {
  fs.writeFileSync(path.join(queueDir, `${id}-DONE.md`), `---\nid: "${id}"\n---\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\nrestagedBootstrap');

test('1: stale NOG_DECISION + DONE → appends RESTAGED + writes marker', () => {
  const { QUEUE, REG, MARKER } = setup();
  writeDone(QUEUE, '999');
  writeReg(REG, [
    { ts: '2026-04-22T13:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T13:19:12.000Z', event: 'NOG_DECISION',  slice_id: '999', verdict: 'REJECTED' },
  ]);

  restagedBootstrap({ queueDir: QUEUE, regFile: REG, markerFile: MARKER });

  const lines = readReg(REG);
  const restaged = lines.filter(l => l.event === 'RESTAGED' && l.slice_id === '999');
  assert.strictEqual(restaged.length, 1, `Expected 1 RESTAGED, got ${restaged.length}`);
  assert.ok(fs.existsSync(MARKER), 'Marker file should exist');
});

test('2: second run with marker present → no-op (idempotent)', () => {
  const { QUEUE, REG, MARKER } = setup();
  writeDone(QUEUE, '999');
  writeReg(REG, [
    { ts: '2026-04-22T13:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T13:19:12.000Z', event: 'NOG_DECISION',  slice_id: '999', verdict: 'REJECTED' },
  ]);
  fs.writeFileSync(MARKER, '2026-04-22T00:00:00.000Z\n');

  restagedBootstrap({ queueDir: QUEUE, regFile: REG, markerFile: MARKER });

  const lines = readReg(REG);
  const restaged = lines.filter(l => l.event === 'RESTAGED');
  assert.strictEqual(restaged.length, 0, 'Second run should not append any RESTAGED');
});

test('3: DONE + register already has RESTAGED → no extra RESTAGED', () => {
  const { QUEUE, REG, MARKER } = setup();
  writeDone(QUEUE, '999');
  writeReg(REG, [
    { ts: '2026-04-22T13:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T13:19:12.000Z', event: 'NOG_DECISION',  slice_id: '999', verdict: 'REJECTED' },
    { ts: '2026-04-22T13:20:00.000Z', event: 'RESTAGED',      slice_id: '999' },
  ]);

  restagedBootstrap({ queueDir: QUEUE, regFile: REG, markerFile: MARKER });

  const lines = readReg(REG);
  const restaged = lines.filter(l => l.event === 'RESTAGED');
  assert.strictEqual(restaged.length, 1, 'Should not add duplicate RESTAGED');
});

test('4: DONE + no review event → no RESTAGED appended', () => {
  const { QUEUE, REG, MARKER } = setup();
  writeDone(QUEUE, '999');
  writeReg(REG, [
    { ts: '2026-04-22T13:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
  ]);

  restagedBootstrap({ queueDir: QUEUE, regFile: REG, markerFile: MARKER });

  const lines = readReg(REG);
  const restaged = lines.filter(l => l.event === 'RESTAGED');
  assert.strictEqual(restaged.length, 0, 'No review event → no rescue needed');
  assert.ok(fs.existsSync(MARKER));
});

test('5: no DONE files → marker written, register unchanged', () => {
  const { QUEUE, REG, MARKER } = setup();
  writeReg(REG, [
    { ts: '2026-04-22T13:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
  ]);

  restagedBootstrap({ queueDir: QUEUE, regFile: REG, markerFile: MARKER });

  const lines = readReg(REG);
  assert.strictEqual(lines.length, 1, 'Register should be unchanged');
  assert.ok(fs.existsSync(MARKER));
});

test('6: multiple wedged DONEs → one RESTAGED per wedged id', () => {
  const { QUEUE, REG, MARKER } = setup();
  writeDone(QUEUE, '111');
  writeDone(QUEUE, '222');
  writeDone(QUEUE, '333');
  writeReg(REG, [
    { ts: '2026-04-22T01:00:00.000Z', event: 'COMMISSIONED', slice_id: '111' },
    { ts: '2026-04-22T01:01:00.000Z', event: 'NOG_DECISION',  slice_id: '111', verdict: 'REJECTED' },
    { ts: '2026-04-22T02:00:00.000Z', event: 'COMMISSIONED', slice_id: '222' },
    { ts: '2026-04-22T02:01:00.000Z', event: 'MERGED',        slice_id: '222', sha: 'abc' },
    { ts: '2026-04-22T03:00:00.000Z', event: 'COMMISSIONED', slice_id: '333' },
    // 333 has no review event → not wedged
  ]);

  restagedBootstrap({ queueDir: QUEUE, regFile: REG, markerFile: MARKER });

  const lines = readReg(REG);
  const restaged = lines.filter(l => l.event === 'RESTAGED');
  assert.strictEqual(restaged.length, 2, `Expected 2 RESTAGED events, got ${restaged.length}`);
  const rescuedIds = new Set(restaged.map(l => l.slice_id));
  assert.ok(rescuedIds.has('111'), 'Should rescue 111');
  assert.ok(rescuedIds.has('222'), 'Should rescue 222');
  assert.ok(!rescuedIds.has('333'), 'Should NOT rescue 333 (no review event)');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
