'use strict';

/**
 * orchestrator-has-review-event.test.js
 *
 * Tests for slice 190 — RESTAGED scoping of hasReviewEvent, hasMergedEvent,
 * and the latestRestagedTs helper in orchestrator.js.
 *
 * Cases:
 *   A: NOG_DECISION at t=1, RESTAGED at t=2 → hasReviewEvent returns false
 *   B: NOG_DECISION at t=1, no RESTAGED     → hasReviewEvent returns true
 *   C: RESTAGED at t=1, NOG_DECISION at t=2 → hasReviewEvent returns true
 *   D: empty register                         → hasReviewEvent returns false
 *   E: MERGED before RESTAGED                → hasMergedEvent returns false
 *   F: MERGED after RESTAGED                 → hasMergedEvent returns true
 *
 * Run: node test/orchestrator-has-review-event.test.js
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const assert = require('assert');

const { latestRestagedTs, hasReviewEvent, hasMergedEvent } = require('../bridge/orchestrator.js');

// ---------------------------------------------------------------------------
// Temp register file helpers
// ---------------------------------------------------------------------------

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ds9-review-event-test-'));
const REG  = path.join(TEMP, 'register.jsonl');

function writeReg(entries) {
  fs.writeFileSync(REG, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

function clearReg() {
  try { fs.unlinkSync(REG); } catch (_) {}
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  clearReg();
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
// latestRestagedTs
// ---------------------------------------------------------------------------

console.log('\nlatestRestagedTs');

test('returns null for empty register', () => {
  writeReg([]);
  assert.strictEqual(latestRestagedTs('999', REG), null);
});

test('returns null when no RESTAGED event for id', () => {
  writeReg([
    { ts: '2026-04-22T01:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T01:00:01.000Z', event: 'RESTAGED', slice_id: '888' },
  ]);
  assert.strictEqual(latestRestagedTs('999', REG), null);
});

test('returns latest ts when multiple RESTAGED events', () => {
  writeReg([
    { ts: '2026-04-22T01:00:00.000Z', event: 'RESTAGED', slice_id: '999' },
    { ts: '2026-04-22T02:00:00.000Z', event: 'RESTAGED', slice_id: '999' },
    { ts: '2026-04-22T01:30:00.000Z', event: 'RESTAGED', slice_id: '999' },
  ]);
  assert.strictEqual(latestRestagedTs('999', REG), '2026-04-22T02:00:00.000Z');
});

test('normalizes legacy "id" field', () => {
  writeReg([
    { ts: '2026-04-22T01:00:00.000Z', event: 'RESTAGED', id: '999' },
  ]);
  assert.strictEqual(latestRestagedTs('999', REG), '2026-04-22T01:00:00.000Z');
});

// ---------------------------------------------------------------------------
// hasReviewEvent
// ---------------------------------------------------------------------------

console.log('\nhasReviewEvent');

// Case D: empty register
test('D: empty register → false', () => {
  writeReg([]);
  assert.strictEqual(hasReviewEvent('999', REG), false);
});

// Case B: NOG_DECISION at t=1, no RESTAGED → true (pre-fix behavior preserved)
test('B: NOG_DECISION, no RESTAGED → true', () => {
  writeReg([
    { ts: '2026-04-22T01:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T01:01:00.000Z', event: 'NOG_DECISION', slice_id: '999', verdict: 'REJECTED' },
  ]);
  assert.strictEqual(hasReviewEvent('999', REG), true);
});

// Case A: NOG_DECISION at t=1, RESTAGED at t=2 → false (reject scoped out)
test('A: NOG_DECISION at t=1, RESTAGED at t=2 → false', () => {
  writeReg([
    { ts: '2026-04-22T01:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T01:01:00.000Z', event: 'NOG_DECISION', slice_id: '999', verdict: 'REJECTED' },
    { ts: '2026-04-22T01:02:00.000Z', event: 'RESTAGED', slice_id: '999' },
  ]);
  assert.strictEqual(hasReviewEvent('999', REG), false);
});

// Case C: RESTAGED at t=1, NOG_DECISION at t=2 → true (current-attempt review present)
test('C: RESTAGED at t=1, NOG_DECISION at t=2 → true', () => {
  writeReg([
    { ts: '2026-04-22T01:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T01:01:00.000Z', event: 'NOG_DECISION', slice_id: '999', verdict: 'REJECTED' },
    { ts: '2026-04-22T01:02:00.000Z', event: 'RESTAGED', slice_id: '999' },
    { ts: '2026-04-22T01:03:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T01:04:00.000Z', event: 'NOG_DECISION', slice_id: '999', verdict: 'ACCEPTED' },
  ]);
  assert.strictEqual(hasReviewEvent('999', REG), true);
});

test('STUCK event before RESTAGED → false', () => {
  writeReg([
    { ts: '2026-04-22T01:00:00.000Z', event: 'STUCK', slice_id: '999' },
    { ts: '2026-04-22T01:01:00.000Z', event: 'RESTAGED', slice_id: '999' },
  ]);
  assert.strictEqual(hasReviewEvent('999', REG), false);
});

test('STUCK event after RESTAGED → true', () => {
  writeReg([
    { ts: '2026-04-22T01:00:00.000Z', event: 'RESTAGED', slice_id: '999' },
    { ts: '2026-04-22T01:01:00.000Z', event: 'STUCK', slice_id: '999' },
  ]);
  assert.strictEqual(hasReviewEvent('999', REG), true);
});

test('unrelated slice events do not affect result', () => {
  writeReg([
    { ts: '2026-04-22T01:00:00.000Z', event: 'NOG_DECISION', slice_id: '888', verdict: 'REJECTED' },
    { ts: '2026-04-22T01:01:00.000Z', event: 'RESTAGED', slice_id: '999' },
  ]);
  assert.strictEqual(hasReviewEvent('999', REG), false);
  assert.strictEqual(hasReviewEvent('888', REG), true);
});

// ---------------------------------------------------------------------------
// hasMergedEvent
// ---------------------------------------------------------------------------

console.log('\nhasMergedEvent');

// Case E: MERGED before RESTAGED → false
test('E: MERGED at t=1, RESTAGED at t=2 → false', () => {
  writeReg([
    { ts: '2026-04-22T01:00:00.000Z', event: 'MERGED', slice_id: '999', sha: 'abc123' },
    { ts: '2026-04-22T01:01:00.000Z', event: 'RESTAGED', slice_id: '999' },
  ]);
  assert.strictEqual(hasMergedEvent('999', REG), false);
});

// Case F: MERGED after RESTAGED → true
test('F: RESTAGED at t=1, MERGED at t=2 → true', () => {
  writeReg([
    { ts: '2026-04-22T01:00:00.000Z', event: 'RESTAGED', slice_id: '999' },
    { ts: '2026-04-22T01:01:00.000Z', event: 'MERGED', slice_id: '999', sha: 'def456' },
  ]);
  assert.strictEqual(hasMergedEvent('999', REG), true);
});

test('MERGED, no RESTAGED → true (pre-fix behavior preserved)', () => {
  writeReg([
    { ts: '2026-04-22T01:00:00.000Z', event: 'MERGED', slice_id: '999', sha: 'abc123' },
  ]);
  assert.strictEqual(hasMergedEvent('999', REG), true);
});

// ---------------------------------------------------------------------------
// Cleanup + summary
// ---------------------------------------------------------------------------

try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch (_) {}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
