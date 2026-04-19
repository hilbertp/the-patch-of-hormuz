'use strict';

/**
 * event-order.test.js
 *
 * Tests for slice 168 — canonical event order: dev -> review -> accept -> merge.
 * Verifies that REVIEW_RECEIVED is emitted synchronously before ACCEPTED/REVIEWED/STUCK,
 * that callReviewAPI call sites are removed, and that the dashboard endpoint no longer
 * writes to the register.
 *
 * Run: node test/event-order.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ---------------------------------------------------------------------------
// Read source files for static analysis
// ---------------------------------------------------------------------------

const watcherSource = fs.readFileSync(
  path.join(__dirname, '..', 'bridge', 'watcher.js'),
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
// Part 1 — handleAccepted event order
// ---------------------------------------------------------------------------

console.log('\n== Event order tests (slice 168) ==\n');
console.log('-- Part 1: handleAccepted --');

test('handleAccepted emits REVIEW_RECEIVED before ACCEPTED', () => {
  // Extract the handleAccepted function body
  const fnMatch = watcherSource.match(/function handleAccepted\([^)]*\)\s*\{([\s\S]*?)^}/m);
  assert(fnMatch, 'Could not find handleAccepted function');
  const body = fnMatch[1];

  const reviewIdx = body.indexOf("registerEvent(id, 'REVIEW_RECEIVED'");
  const acceptedIdx = body.indexOf("registerEvent(id, 'ACCEPTED'");

  assert(reviewIdx !== -1, 'REVIEW_RECEIVED registerEvent not found in handleAccepted');
  assert(acceptedIdx !== -1, 'ACCEPTED registerEvent not found in handleAccepted');
  assert(reviewIdx < acceptedIdx,
    `REVIEW_RECEIVED (pos ${reviewIdx}) must come before ACCEPTED (pos ${acceptedIdx})`);
});

test('handleAccepted REVIEW_RECEIVED carries verdict and reason', () => {
  const fnMatch = watcherSource.match(/function handleAccepted\([^)]*\)\s*\{([\s\S]*?)^}/m);
  const body = fnMatch[1];

  const reviewLine = body.match(/registerEvent\(id,\s*'REVIEW_RECEIVED',\s*\{([^}]+)\}/);
  assert(reviewLine, 'Could not find REVIEW_RECEIVED registerEvent call');
  assert(reviewLine[1].includes('verdict'), 'REVIEW_RECEIVED must carry verdict');
  assert(reviewLine[1].includes('reason'), 'REVIEW_RECEIVED must carry reason');
});

test('handleAccepted ACCEPTED event does NOT carry reason', () => {
  const fnMatch = watcherSource.match(/function handleAccepted\([^)]*\)\s*\{([\s\S]*?)^}/m);
  const body = fnMatch[1];

  const acceptedLine = body.match(/registerEvent\(id,\s*'ACCEPTED',\s*\{([^}]+)\}/);
  assert(acceptedLine, 'Could not find ACCEPTED registerEvent call');
  assert(!acceptedLine[1].includes('reason'),
    'ACCEPTED event must NOT carry reason (decision-only)');
});

test('handleAccepted does not call callReviewAPI', () => {
  const fnMatch = watcherSource.match(/function handleAccepted\([^)]*\)\s*\{([\s\S]*?)^}/m);
  const body = fnMatch[1];

  assert(!body.includes('callReviewAPI('),
    'handleAccepted must not call callReviewAPI');
});

// ---------------------------------------------------------------------------
// Part 2 — handleApendment event order
// ---------------------------------------------------------------------------

console.log('\n-- Part 2: handleApendment --');

test('handleApendment emits REVIEW_RECEIVED before REVIEWED', () => {
  const fnMatch = watcherSource.match(/function handleApendment\([^)]*\)\s*\{([\s\S]*?)^}/m);
  assert(fnMatch, 'Could not find handleApendment function');
  const body = fnMatch[1];

  const reviewIdx = body.indexOf("registerEvent(id, 'REVIEW_RECEIVED'");
  const reviewedIdx = body.indexOf("registerEvent(id, 'REVIEWED'");

  assert(reviewIdx !== -1, 'REVIEW_RECEIVED registerEvent not found in handleApendment');
  assert(reviewedIdx !== -1, 'REVIEWED registerEvent not found in handleApendment');
  assert(reviewIdx < reviewedIdx,
    `REVIEW_RECEIVED (pos ${reviewIdx}) must come before REVIEWED (pos ${reviewedIdx})`);
});

test('handleApendment REVIEW_RECEIVED carries verdict and reason', () => {
  const fnMatch = watcherSource.match(/function handleApendment\([^)]*\)\s*\{([\s\S]*?)^}/m);
  const body = fnMatch[1];

  const reviewLine = body.match(/registerEvent\(id,\s*'REVIEW_RECEIVED',\s*\{([^}]+)\}/);
  assert(reviewLine, 'Could not find REVIEW_RECEIVED registerEvent call');
  assert(reviewLine[1].includes("'APENDMENT_NEEDED'"), 'REVIEW_RECEIVED must carry APENDMENT_NEEDED verdict');
  assert(reviewLine[1].includes('reason'), 'REVIEW_RECEIVED must carry reason');
});

test('handleApendment does not call callReviewAPI', () => {
  const fnMatch = watcherSource.match(/function handleApendment\([^)]*\)\s*\{([\s\S]*?)^}/m);
  const body = fnMatch[1];

  assert(!body.includes('callReviewAPI('),
    'handleApendment must not call callReviewAPI');
});

// ---------------------------------------------------------------------------
// Part 3 — handleStuck event order
// ---------------------------------------------------------------------------

console.log('\n-- Part 3: handleStuck --');

test('handleStuck emits REVIEW_RECEIVED before STUCK', () => {
  const fnMatch = watcherSource.match(/function handleStuck\([^)]*\)\s*\{([\s\S]*?)^}/m);
  assert(fnMatch, 'Could not find handleStuck function');
  const body = fnMatch[1];

  const reviewIdx = body.indexOf("registerEvent(id, 'REVIEW_RECEIVED'");
  const stuckIdx = body.indexOf("registerEvent(id, 'STUCK'");

  assert(reviewIdx !== -1, 'REVIEW_RECEIVED registerEvent not found in handleStuck');
  assert(stuckIdx !== -1, 'STUCK registerEvent not found in handleStuck');
  assert(reviewIdx < stuckIdx,
    `REVIEW_RECEIVED (pos ${reviewIdx}) must come before STUCK (pos ${stuckIdx})`);
});

test('handleStuck REVIEW_RECEIVED carries verdict and reason', () => {
  const fnMatch = watcherSource.match(/function handleStuck\([^)]*\)\s*\{([\s\S]*?)^}/m);
  const body = fnMatch[1];

  const reviewLine = body.match(/registerEvent\(id,\s*'REVIEW_RECEIVED',\s*\{([^}]+)\}/);
  assert(reviewLine, 'Could not find REVIEW_RECEIVED registerEvent call');
  assert(reviewLine[1].includes("'STUCK'"), 'REVIEW_RECEIVED must carry STUCK verdict');
  assert(reviewLine[1].includes('reason'), 'REVIEW_RECEIVED must carry reason');
});

test('handleStuck STUCK event does NOT carry reason', () => {
  const fnMatch = watcherSource.match(/function handleStuck\([^)]*\)\s*\{([\s\S]*?)^}/m);
  const body = fnMatch[1];

  const stuckLine = body.match(/registerEvent\(id,\s*'STUCK',\s*\{([^}]+)\}/);
  assert(stuckLine, 'Could not find STUCK registerEvent call');
  assert(!stuckLine[1].includes('reason'),
    'STUCK event must NOT carry reason (decision-only)');
});

test('handleStuck does not call callReviewAPI', () => {
  const fnMatch = watcherSource.match(/function handleStuck\([^)]*\)\s*\{([\s\S]*?)^}/m);
  const body = fnMatch[1];

  assert(!body.includes('callReviewAPI('),
    'handleStuck must not call callReviewAPI');
});

// ---------------------------------------------------------------------------
// Part 4 — Auto-accept path event order
// ---------------------------------------------------------------------------

console.log('\n-- Part 4: Auto-accept path --');

test('auto-accept path emits REVIEW_RECEIVED before ACCEPTED', () => {
  // The auto-accept block is identified by 'auto-accepted merge'
  const autoBlock = watcherSource.match(/if \(sliceMeta\.type === 'merge'\)\s*\{([\s\S]*?)continue;/);
  assert(autoBlock, 'Could not find auto-accept merge block');
  const body = autoBlock[1];

  const reviewIdx = body.indexOf("registerEvent(doneId, 'REVIEW_RECEIVED'");
  const acceptedIdx = body.indexOf("registerEvent(doneId, 'ACCEPTED'");

  assert(reviewIdx !== -1, 'REVIEW_RECEIVED not found in auto-accept block');
  assert(acceptedIdx !== -1, 'ACCEPTED not found in auto-accept block');
  assert(reviewIdx < acceptedIdx,
    `REVIEW_RECEIVED (pos ${reviewIdx}) must come before ACCEPTED (pos ${acceptedIdx})`);
});

test('auto-accept path does not call callReviewAPI', () => {
  const autoBlock = watcherSource.match(/if \(sliceMeta\.type === 'merge'\)\s*\{([\s\S]*?)continue;/);
  const body = autoBlock[1];

  assert(!body.includes('callReviewAPI('),
    'auto-accept block must not call callReviewAPI');
});

// ---------------------------------------------------------------------------
// Part 5 — Global: no callReviewAPI call sites remain
// ---------------------------------------------------------------------------

console.log('\n-- Part 5: callReviewAPI removal --');

test('callReviewAPI has zero call sites (only the function definition remains)', () => {
  // Match callReviewAPI( but exclude the function definition line itself
  const calls = watcherSource.split('\n').filter(line =>
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
  // Find the review endpoint handler block
  const reviewBlock = dashboardSource.match(/if \(pathname === '\/api\/bridge\/review'\)\s*\{([\s\S]*?)return;\s*\}/);
  assert(reviewBlock, 'Could not find /api/bridge/review handler');
  const body = reviewBlock[1];

  assert(!body.includes('writeRegisterEvent('),
    'The /api/bridge/review endpoint must NOT call writeRegisterEvent');
});

test('dashboard /api/bridge/review returns nudge response', () => {
  // Find everything between the /api/bridge/review handler and the next top-level route
  const startIdx = dashboardSource.indexOf("if (pathname === '/api/bridge/review')");
  assert(startIdx !== -1, 'Could not find /api/bridge/review handler');
  // Find the next top-level route to bound the search
  const nextRoute = dashboardSource.indexOf("if (pathname === '", startIdx + 10);
  const body = dashboardSource.slice(startIdx, nextRoute !== -1 ? nextRoute : undefined);

  assert(body.includes('nudge'), 'The endpoint should indicate it is a UI-refresh nudge');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n== Results: ${passed} passed, ${failed} failed ==\n`);
process.exit(failed > 0 ? 1 : 0);
