'use strict';

/**
 * event-order.test.js
 *
 * Tests for canonical event emission in the orchestrator.
 * Verifies that NOG_DECISION is emitted with verdict and reason,
 * that REVIEW_RECEIVED/ACCEPTED-as-event are no longer emitted,
 * that callReviewAPI call sites are removed, and that the dashboard
 * endpoint no longer writes to the register.
 *
 * Run: node test/event-order.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ---------------------------------------------------------------------------
// Read source files for static analysis
// ---------------------------------------------------------------------------

const orchestratorSource = fs.readFileSync(
  path.join(__dirname, '..', 'bridge', 'orchestrator.js'),
  'utf-8'
);

const dashboardSource = fs.readFileSync(
  path.join(__dirname, '..', 'dashboard', 'server.js'),
  'utf-8'
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \u2717 ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Part 1 — handleAccepted emits NOG_DECISION (canonical)
// ---------------------------------------------------------------------------

console.log('\n== Event order tests (canonical events) ==\n');
console.log('-- Part 1: handleAccepted --');

test('handleAccepted emits NOG_DECISION with verdict ACCEPTED', () => {
  const fnMatch = orchestratorSource.match(/function handleAccepted\([^)]*\)\s*\{([\s\S]*?)^}/m);
  assert(fnMatch, 'Could not find handleAccepted function');
  const body = fnMatch[1];

  const nogDecision = body.match(/registerEvent\(id,\s*'NOG_DECISION',\s*\{([^}]+)\}/);
  assert(nogDecision, 'NOG_DECISION registerEvent not found in handleAccepted');
  assert(nogDecision[1].includes("'ACCEPTED'"), 'NOG_DECISION must carry ACCEPTED verdict');
  assert(nogDecision[1].includes('reason'), 'NOG_DECISION must carry reason');
  assert(nogDecision[1].includes('round'), 'NOG_DECISION must carry round');
});

test('handleAccepted does NOT emit REVIEW_RECEIVED', () => {
  const fnMatch = orchestratorSource.match(/function handleAccepted\([^)]*\)\s*\{([\s\S]*?)^}/m);
  const body = fnMatch[1];
  assert(!body.includes("'REVIEW_RECEIVED'"), 'handleAccepted must not emit REVIEW_RECEIVED');
});

test('handleAccepted does NOT emit ACCEPTED as separate event', () => {
  const fnMatch = orchestratorSource.match(/function handleAccepted\([^)]*\)\s*\{([\s\S]*?)^}/m);
  const body = fnMatch[1];
  // Should not have registerEvent(id, 'ACCEPTED' — only NOG_DECISION
  const acceptedCalls = (body.match(/registerEvent\(id,\s*'ACCEPTED'/g) || []);
  assert.strictEqual(acceptedCalls.length, 0, 'handleAccepted must not emit ACCEPTED as separate event');
});

test('handleAccepted does not call callReviewAPI', () => {
  const fnMatch = orchestratorSource.match(/function handleAccepted\([^)]*\)\s*\{([\s\S]*?)^}/m);
  const body = fnMatch[1];
  assert(!body.includes('callReviewAPI('), 'handleAccepted must not call callReviewAPI');
});

// ---------------------------------------------------------------------------
// Part 2 — handleApendment removed (slice 191); invokeNog emits NOG_DECISION REJECTED
// ---------------------------------------------------------------------------

console.log('\n-- Part 2: handleApendment removed; invokeNog emits REJECTED --');

test('handleApendment does NOT exist (removed slice 191: dead code after evaluator merge)', () => {
  assert(!orchestratorSource.includes('function handleApendment('), 'handleApendment must be removed');
});

test('invokeNog emits NOG_DECISION with verdict REJECTED on REJECTED path', () => {
  const fnMatch = orchestratorSource.match(/function invokeNog\([^)]*\)\s*\{([\s\S]*?)^function /m);
  assert(fnMatch, 'Could not find invokeNog function');
  const body = fnMatch[1];
  const rejectedLine = body.match(/registerEvent\(id,\s*'NOG_DECISION',\s*\{[^}]*'REJECTED'/);
  assert(rejectedLine, 'invokeNog must emit NOG_DECISION with REJECTED verdict');
});

test('invokeNog REJECTED path does not emit REVIEW_RECEIVED or REVIEWED', () => {
  const fnMatch = orchestratorSource.match(/function invokeNog\([^)]*\)\s*\{([\s\S]*?)^function /m);
  const body = fnMatch[1];
  assert(!body.includes("'REVIEW_RECEIVED'"), 'invokeNog must not emit REVIEW_RECEIVED');
  assert(!body.includes("'REVIEWED'"), 'invokeNog must not emit REVIEWED');
});

// ---------------------------------------------------------------------------
// Part 3 — handleStuck (evaluator version) removed (slice 191)
// ---------------------------------------------------------------------------

console.log('\n-- Part 3: handleStuck (evaluator version) removed --');

test('handleStuck does NOT exist as evaluator handler (removed slice 191)', () => {
  assert(!orchestratorSource.includes('function handleStuck('), 'handleStuck must be removed');
});

test('STUCK state is still reachable via Nog escalation (MAX_ROUNDS_EXHAUSTED path)', () => {
  assert(
    orchestratorSource.includes("'STUCK'") && orchestratorSource.includes("'MAX_ROUNDS_EXHAUSTED'"),
    'Nog escalation path must still register STUCK/MAX_ROUNDS_EXHAUSTED'
  );
});

// ---------------------------------------------------------------------------
// Part 4 — Auto-accept path emits NOG_DECISION
// ---------------------------------------------------------------------------

console.log('\n-- Part 4: Auto-accept path --');

test('auto-accept path emits NOG_DECISION', () => {
  const autoBlock = orchestratorSource.match(/if \(sliceMeta\.type === 'merge'\)\s*\{([\s\S]*?)continue;/);
  assert(autoBlock, 'Could not find auto-accept merge block');
  const body = autoBlock[1];

  assert(body.includes("'NOG_DECISION'"), 'auto-accept must emit NOG_DECISION');
  assert(!body.includes("'REVIEW_RECEIVED'"), 'auto-accept must not emit REVIEW_RECEIVED');
  assert(!body.includes("registerEvent(doneId, 'ACCEPTED'"), 'auto-accept must not emit ACCEPTED as separate event');
});

test('auto-accept path does not call callReviewAPI', () => {
  const autoBlock = orchestratorSource.match(/if \(sliceMeta\.type === 'merge'\)\s*\{([\s\S]*?)continue;/);
  const body = autoBlock[1];
  assert(!body.includes('callReviewAPI('), 'auto-accept block must not call callReviewAPI');
});

// ---------------------------------------------------------------------------
// Part 5 — Global: no callReviewAPI call sites remain
// ---------------------------------------------------------------------------

console.log('\n-- Part 5: callReviewAPI removal --');

test('callReviewAPI has zero call sites (only the function definition remains)', () => {
  const calls = orchestratorSource.split('\n').filter(line =>
    line.includes('callReviewAPI(') &&
    !line.trim().startsWith('function callReviewAPI') &&
    !line.trim().startsWith('*')
  );
  assert.strictEqual(calls.length, 0,
    `Expected 0 callReviewAPI call sites, found ${calls.length}:\n${calls.join('\n')}`);
});

// ---------------------------------------------------------------------------
// Part 6 — Dashboard /api/bridge/review no longer writes to register
// ---------------------------------------------------------------------------

console.log('\n-- Part 6: Dashboard endpoint demoted --');

test('dashboard /api/bridge/review does NOT call writeRegisterEvent', () => {
  const reviewBlock = dashboardSource.match(/if \(pathname === '\/api\/bridge\/review'\)\s*\{([\s\S]*?)return;\s*\}/);
  assert(reviewBlock, 'Could not find /api/bridge/review handler');
  const body = reviewBlock[1];
  assert(!body.includes('writeRegisterEvent('),
    'The /api/bridge/review endpoint must NOT call writeRegisterEvent');
});

test('dashboard /api/bridge/review returns nudge response', () => {
  const startIdx = dashboardSource.indexOf("if (pathname === '/api/bridge/review')");
  assert(startIdx !== -1, 'Could not find /api/bridge/review handler');
  const nextRoute = dashboardSource.indexOf("if (pathname === '", startIdx + 10);
  const body = dashboardSource.slice(startIdx, nextRoute !== -1 ? nextRoute : undefined);
  assert(body.includes('nudge'), 'The endpoint should indicate it is a UI-refresh nudge');
});

// ---------------------------------------------------------------------------
// Part 7 — No legacy event emissions in orchestrator write side
// ---------------------------------------------------------------------------

console.log('\n-- Part 7: No legacy event emissions --');

test('orchestrator does not emit REVIEW_RECEIVED anywhere', () => {
  const calls = (orchestratorSource.match(/registerEvent\([^,]+,\s*'REVIEW_RECEIVED'/g) || []);
  assert.strictEqual(calls.length, 0,
    `Expected 0 REVIEW_RECEIVED emissions, found ${calls.length}`);
});

test('orchestrator does not emit NOG_PASS anywhere', () => {
  const calls = (orchestratorSource.match(/registerEvent\([^,]+,\s*'NOG_PASS'/g) || []);
  assert.strictEqual(calls.length, 0,
    `Expected 0 NOG_PASS emissions, found ${calls.length}`);
});

test('orchestrator does not emit ROM_WAITING_FOR_NOG anywhere', () => {
  const calls = (orchestratorSource.match(/registerEvent\([^,]+,\s*'ROM_WAITING_FOR_NOG'/g) || []);
  assert.strictEqual(calls.length, 0,
    `Expected 0 ROM_WAITING_FOR_NOG emissions, found ${calls.length}`);
});

test('orchestrator does not emit REVIEWED anywhere', () => {
  const calls = (orchestratorSource.match(/registerEvent\([^,]+,\s*'REVIEWED'/g) || []);
  assert.strictEqual(calls.length, 0,
    `Expected 0 REVIEWED emissions, found ${calls.length}`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n== Results: ${passed} passed, ${failed} failed ==\n`);
process.exit(failed > 0 ? 1 : 0);
