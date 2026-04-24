'use strict';

/**
 * orchestrator-has-review-event.test.js
 *
 * Tests for RESTAGED scoping of hasReviewEvent, hasMergedEvent,
 * latestRestagedTs, and latestAttemptStartTs helpers in orchestrator.js.
 *
 * Original cases (slice 190):
 *   A: NOG_DECISION at t=1, RESTAGED at t=2 → hasReviewEvent returns false
 *   B: NOG_DECISION ACCEPTED, no RESTAGED    → hasReviewEvent returns true
 *   C: RESTAGED at t=1, NOG_DECISION ACCEPTED at t=2 → true
 *   D: empty register                         → hasReviewEvent returns false
 *   E: MERGED before RESTAGED                → hasMergedEvent returns false
 *   F: MERGED after RESTAGED                 → hasMergedEvent returns true
 *
 * Dispatch gate cases (slice 197):
 *   197-A: REJECTED does not block re-dispatch → false
 *   197-B: ACCEPTED blocks re-dispatch → true
 *   197-C: MERGED blocks → true
 *   197-D: STUCK blocks → true
 *   197-E: Cutoff via RESTAGED — pre-cutoff REJECTED ignored → false
 *   197-F: Cutoff via COMMISSIONED fallback — pre-cutoff REJECTED ignored → false
 *   197-G: ESCALATE is not terminal → false
 *
 * Run: node test/orchestrator-has-review-event.test.js
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const assert = require('assert');

const { latestRestagedTs, latestAttemptStartTs, hasReviewEvent, hasMergedEvent } = require('../bridge/orchestrator.js');

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

// Case B: NOG_DECISION ACCEPTED, no RESTAGED → true (ACCEPTED is terminal)
test('B: NOG_DECISION ACCEPTED, no RESTAGED → true', () => {
  writeReg([
    { ts: '2026-04-22T01:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T01:01:00.000Z', event: 'NOG_DECISION', slice_id: '999', verdict: 'ACCEPTED' },
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

// Case C: RESTAGED at t=1, NOG_DECISION ACCEPTED at t=2 → true (current-attempt review present)
test('C: RESTAGED at t=1, NOG_DECISION ACCEPTED at t=2 → true', () => {
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
    { ts: '2026-04-22T01:00:00.000Z', event: 'COMMISSIONED', slice_id: '888' },
    { ts: '2026-04-22T01:00:30.000Z', event: 'NOG_DECISION', slice_id: '888', verdict: 'ACCEPTED' },
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
// latestAttemptStartTs (slice 197)
// ---------------------------------------------------------------------------

console.log('\nlatestAttemptStartTs');

test('returns null when no RESTAGED or COMMISSIONED', () => {
  writeReg([
    { ts: '2026-04-22T01:00:00.000Z', event: 'NOG_DECISION', slice_id: '999', verdict: 'REJECTED' },
  ]);
  assert.strictEqual(latestAttemptStartTs('999', REG), null);
});

test('returns RESTAGED ts when present (ignores COMMISSIONED)', () => {
  writeReg([
    { ts: '2026-04-22T09:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T10:00:00.000Z', event: 'RESTAGED', slice_id: '999' },
    { ts: '2026-04-22T10:01:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
  ]);
  assert.strictEqual(latestAttemptStartTs('999', REG), '2026-04-22T10:00:00.000Z');
});

test('falls back to latest COMMISSIONED when no RESTAGED', () => {
  writeReg([
    { ts: '2026-04-22T09:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-23T09:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
  ]);
  assert.strictEqual(latestAttemptStartTs('999', REG), '2026-04-23T09:00:00.000Z');
});

test('returns null for empty register', () => {
  writeReg([]);
  assert.strictEqual(latestAttemptStartTs('999', REG), null);
});

// ---------------------------------------------------------------------------
// Dispatch gate regression tests (slice 197 — Tests A–G)
// ---------------------------------------------------------------------------

console.log('\nhasReviewEvent — dispatch gate (slice 197)');

// Test 197-A: REJECTED does not block re-dispatch
test('197-A: REJECTED verdict → false (not terminal, must re-dispatch)', () => {
  writeReg([
    { ts: '2026-04-22T10:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T10:01:00.000Z', event: 'NOG_INVOKED', slice_id: '999', round: 1 },
    { ts: '2026-04-22T10:34:00.000Z', event: 'NOG_DECISION', slice_id: '999', verdict: 'REJECTED', round: 1 },
  ]);
  assert.strictEqual(hasReviewEvent('999', REG), false);
});

// Test 197-B: ACCEPTED blocks re-dispatch
test('197-B: ACCEPTED verdict → true (terminal)', () => {
  writeReg([
    { ts: '2026-04-22T10:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T10:01:00.000Z', event: 'NOG_INVOKED', slice_id: '999', round: 1 },
    { ts: '2026-04-22T10:34:00.000Z', event: 'NOG_DECISION', slice_id: '999', verdict: 'ACCEPTED', round: 1 },
  ]);
  assert.strictEqual(hasReviewEvent('999', REG), true);
});

// Test 197-C: MERGED blocks
test('197-C: MERGED event → true (terminal)', () => {
  writeReg([
    { ts: '2026-04-22T10:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T10:34:00.000Z', event: 'NOG_DECISION', slice_id: '999', verdict: 'ACCEPTED' },
    { ts: '2026-04-22T10:35:00.000Z', event: 'MERGED', slice_id: '999', sha: 'abc123' },
  ]);
  assert.strictEqual(hasReviewEvent('999', REG), true);
});

// Test 197-D: STUCK blocks
test('197-D: STUCK event → true (terminal)', () => {
  writeReg([
    { ts: '2026-04-22T10:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T10:34:00.000Z', event: 'STUCK', slice_id: '999' },
  ]);
  assert.strictEqual(hasReviewEvent('999', REG), true);
});

// Test 197-E: cutoff via RESTAGED — yesterday's REJECTED pre-cutoff
test('197-E: RESTAGED cutoff — pre-RESTAGED REJECTED ignored → false', () => {
  writeReg([
    { ts: '2026-04-22T10:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T10:34:00.000Z', event: 'NOG_DECISION', slice_id: '999', verdict: 'REJECTED' },
    { ts: '2026-04-23T09:00:00.000Z', event: 'RESTAGED', slice_id: '999' },
  ]);
  assert.strictEqual(hasReviewEvent('999', REG), false);
});

// Test 197-F: cutoff via COMMISSIONED fallback — no RESTAGED, new attempt via COMMISSIONED
test('197-F: COMMISSIONED fallback cutoff — pre-cutoff REJECTED ignored → false', () => {
  writeReg([
    { ts: '2026-04-22T10:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T10:34:00.000Z', event: 'NOG_DECISION', slice_id: '999', verdict: 'REJECTED' },
    { ts: '2026-04-23T09:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
  ]);
  assert.strictEqual(hasReviewEvent('999', REG), false);
});

// Test 197-G: ESCALATE verdict is not terminal
test('197-G: ESCALATE verdict → false (not terminal)', () => {
  writeReg([
    { ts: '2026-04-22T10:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
    { ts: '2026-04-22T10:34:00.000Z', event: 'NOG_DECISION', slice_id: '999', verdict: 'ESCALATE' },
  ]);
  assert.strictEqual(hasReviewEvent('999', REG), false);
});

// ---------------------------------------------------------------------------
// Cleanup + summary
// ---------------------------------------------------------------------------

try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch (_) {}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
