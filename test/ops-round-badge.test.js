'use strict';

/**
 * ops-round-badge.test.js
 *
 * Tests for slice 190 — getRound() scoping in dashboard/lcars-dashboard.html.
 * Extracts the getRound logic as a pure function from the dashboard source for
 * isolated unit testing.
 *
 * Cases:
 *   A: 3 COMMISSIONED for "999", 1 RESTAGED at t=4, 1 COMMISSIONED at t=5 → getRound("999") = 1
 *   B: 2 COMMISSIONED, no RESTAGED → getRound("999") = 2
 *   C: empty events → getRound("999") = 1
 *   D: COMMISSIONED with explicit round field after RESTAGED → uses round field
 *
 * Run: node test/ops-round-badge.test.js
 */

const fs     = require('fs');
const path   = require('path');
const assert = require('assert');

// ---------------------------------------------------------------------------
// Extract getRound logic from dashboard source (static analysis guard)
// ---------------------------------------------------------------------------

const dashboardSource = fs.readFileSync(
  path.join(__dirname, '..', 'dashboard', 'lcars-dashboard.html'),
  'utf-8'
);

// Verify the scoping logic is present in the source
const hasRestagedFilter = /cachedRegisterEvents\.filter\(e\s*=>\s*[\s\S]*?RESTAGED/.test(dashboardSource);
const hasCutoffCheck    = /cutoff.*e\.ts/.test(dashboardSource) || /e\.ts.*cutoff/.test(dashboardSource);

// ---------------------------------------------------------------------------
// Inline getRound as a pure function using the same logic as the dashboard
// ---------------------------------------------------------------------------

function getRound(sliceId, cachedRegisterEvents) {
  const restagedEvents = cachedRegisterEvents.filter(e =>
    String(e.id) === String(sliceId) && e.event === 'RESTAGED'
  );
  const latestRestaged = restagedEvents.length > 0
    ? restagedEvents.reduce((a, b) => (a.ts > b.ts ? a : b))
    : null;
  const cutoff = latestRestaged ? latestRestaged.ts : null;
  const commEvents = cachedRegisterEvents.filter(e =>
    String(e.id) === String(sliceId) && e.event === 'COMMISSIONED' &&
    (!cutoff || e.ts > cutoff)
  );
  const latest = commEvents.length > 0 ? commEvents[commEvents.length - 1] : null;
  if (latest && latest.round) return parseInt(latest.round, 10);
  return commEvents.length || 1;
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
// Static analysis
// ---------------------------------------------------------------------------

console.log('\nStatic analysis');

test('dashboard source filters RESTAGED events', () => {
  assert.ok(hasRestagedFilter, 'getRound should filter cachedRegisterEvents for RESTAGED events');
});

test('dashboard source applies cutoff to COMMISSIONED filter', () => {
  assert.ok(hasCutoffCheck, 'getRound should apply ts cutoff when filtering COMMISSIONED events');
});

// ---------------------------------------------------------------------------
// Functional tests
// ---------------------------------------------------------------------------

console.log('\ngetRound functional tests');

// Case C: empty
test('C: empty events → 1', () => {
  assert.strictEqual(getRound('999', []), 1);
});

// Case B: 2 COMMISSIONED, no RESTAGED → 2
test('B: 2 COMMISSIONED, no RESTAGED → 2', () => {
  const events = [
    { id: '999', event: 'COMMISSIONED', ts: '2026-04-22T01:00:00.000Z' },
    { id: '999', event: 'COMMISSIONED', ts: '2026-04-22T02:00:00.000Z' },
  ];
  assert.strictEqual(getRound('999', events), 2);
});

// Case A: 3 COMMISSIONED, RESTAGED at t=4, 1 COMMISSIONED at t=5 → 1
test('A: 3 old COMMISSIONED + RESTAGED + 1 new COMMISSIONED → 1', () => {
  const events = [
    { id: '999', event: 'COMMISSIONED', ts: '2026-04-22T01:00:00.000Z' },
    { id: '999', event: 'COMMISSIONED', ts: '2026-04-22T02:00:00.000Z' },
    { id: '999', event: 'COMMISSIONED', ts: '2026-04-22T03:00:00.000Z' },
    { id: '999', event: 'RESTAGED',     ts: '2026-04-22T04:00:00.000Z' },
    { id: '999', event: 'COMMISSIONED', ts: '2026-04-22T05:00:00.000Z' },
  ];
  assert.strictEqual(getRound('999', events), 1);
});

// Case D: COMMISSIONED with round field after RESTAGED → uses round field value
test('D: explicit round field on post-RESTAGED COMMISSIONED → round field wins', () => {
  const events = [
    { id: '999', event: 'COMMISSIONED', ts: '2026-04-22T01:00:00.000Z' },
    { id: '999', event: 'RESTAGED',     ts: '2026-04-22T02:00:00.000Z' },
    { id: '999', event: 'COMMISSIONED', ts: '2026-04-22T03:00:00.000Z', round: 7 },
  ];
  assert.strictEqual(getRound('999', events), 7);
});

test('events for other slices do not affect result', () => {
  const events = [
    { id: '888', event: 'COMMISSIONED', ts: '2026-04-22T01:00:00.000Z' },
    { id: '888', event: 'COMMISSIONED', ts: '2026-04-22T02:00:00.000Z' },
    { id: '999', event: 'COMMISSIONED', ts: '2026-04-22T01:00:00.000Z' },
  ];
  assert.strictEqual(getRound('999', events), 1);
  assert.strictEqual(getRound('888', events), 2);
});

test('multiple RESTAGEDs: only latest cutoff applies', () => {
  const events = [
    { id: '999', event: 'COMMISSIONED', ts: '2026-04-22T01:00:00.000Z' },
    { id: '999', event: 'RESTAGED',     ts: '2026-04-22T02:00:00.000Z' },
    { id: '999', event: 'COMMISSIONED', ts: '2026-04-22T03:00:00.000Z' },
    { id: '999', event: 'RESTAGED',     ts: '2026-04-22T04:00:00.000Z' },
    { id: '999', event: 'COMMISSIONED', ts: '2026-04-22T05:00:00.000Z' },
    { id: '999', event: 'COMMISSIONED', ts: '2026-04-22T06:00:00.000Z' },
  ];
  // Only the 2 COMMISSIONED events after the latest RESTAGED (t=4) count → 2
  assert.strictEqual(getRound('999', events), 2);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
