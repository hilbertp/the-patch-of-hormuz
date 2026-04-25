'use strict';

/**
 * slice-investigation.test.js
 *
 * Regression tests for slice 189 — Ops investigation panel:
 *   1.  /api/slice/:id route exists in server.js with numeric-only regex
 *   2.  400 handler for non-numeric slice IDs present in server.js
 *   3.  buildSliceInvestigation: STAGED-only → prompt set, report null, reviews []
 *   4.  buildSliceInvestigation: IN_PROGRESS → prompt set from IN_PROGRESS body
 *   5.  buildSliceInvestigation: DONE single-round (no NOG.md) → reviews []
 *   6.  buildSliceInvestigation: DONE + NOG.md → reviews.length === 1, round=1
 *   7.  buildSliceInvestigation: PARKED multi-round (N=3) → reviews.length === 3, all fields
 *   8.  buildSliceInvestigation: STUCK multi-round (N=5) → reviews.length === 5, report = STUCK body
 *   9.  buildSliceInvestigation: ERROR → report = ERROR body
 *  10.  buildSliceInvestigation: unknown ID → throws with status 404
 *  11.  Path traversal: numeric regex rejects non-numeric IDs
 *  12.  Dashboard HTML: inv-panel-overlay element present
 *  13.  Dashboard HTML: three inv-pane divs (prompt, report, review)
 *  14.  Dashboard HTML: accordion renders <details> per round in renderInvAccordion
 *  15.  Dashboard HTML: multi-round rom accordion required (AC 4)
 *  16.  Dashboard HTML: queue-list event delegation present
 *  17.  Dashboard HTML: history-list event delegation present
 *  18.  Dashboard HTML: Esc key closes panel
 *  19.  Dashboard HTML: backdrop click closes panel
 *  20.  No dead imports in this test file
 *
 * Run: node test/slice-investigation.test.js
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const assert = require('assert');

const REPO_ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      result.then(() => { passed++; console.log(`  ✓ ${name}`); })
            .catch(e => { failed++; console.log(`  ✗ ${name}`); console.log(`    ${e.message}`); });
      return result;
    }
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Static source files
// ---------------------------------------------------------------------------

const serverSource = fs.readFileSync(path.join(REPO_ROOT, 'dashboard', 'server.js'), 'utf8');
const dashSource   = fs.readFileSync(path.join(REPO_ROOT, 'dashboard', 'lcars-dashboard.html'), 'utf8');

// ---------------------------------------------------------------------------
// Temp dir setup for integration tests
// ---------------------------------------------------------------------------

const TEMP = path.join(os.tmpdir(), `ds9-inv-test-${Date.now()}`);
const QUEUE  = path.join(TEMP, 'queue');
const STAGED = path.join(TEMP, 'staged');
fs.mkdirSync(QUEUE,  { recursive: true });
fs.mkdirSync(STAGED, { recursive: true });

// Seed helpers
function writeQueue(filename, content) { fs.writeFileSync(path.join(QUEUE, filename), content, 'utf8'); }
function writeStaged(filename, content) { fs.writeFileSync(path.join(STAGED, filename), content, 'utf8'); }

function frontmatter(fields) {
  return `---\n${Object.entries(fields).map(([k,v]) => `${k}: "${v}"`).join('\n')}\n---`;
}

// Seed test slices
// 901: STAGED-only (in staged dir, no queue file)
writeStaged('901-STAGED.md', frontmatter({ id: '901', status: 'STAGED', title: 'Test STAGED' }) + '\n\nOriginal brief body here.\n');

// 902: IN_PROGRESS (in queue)
writeQueue('902-IN_PROGRESS.md', frontmatter({ id: '902', status: 'IN_PROGRESS', title: 'Test IN_PROGRESS' }) + '\n\nBrief for in-progress slice.\n');

// 903: DONE single-round (no NOG.md)
writeQueue('903-DONE.md', frontmatter({ id: '903', status: 'DONE', title: 'Test DONE' }) + '\n\nRom report for single-round slice.\n');

// 904: DONE + NOG.md (single-round with review)
writeQueue('904-DONE.md', frontmatter({ id: '904', status: 'DONE', title: 'Test DONE+NOG' }) + '\n\nRom report body.\n');
writeQueue('904-NOG.md', frontmatter({ id: '904', verdict: 'ACCEPTED', summary: 'All ACs met', completed: '2026-04-20T10:00:00.000Z' }) + '\n\nNog review text here.\n');

// 905: PARKED multi-round (N=3) with rounds[] in frontmatter
const parkedFm = `---
id: "905"
title: "Test PARKED multi-round"
status: PARKED
rounds:
  - round: 1
    done_at: "2026-04-19T10:00:00.000Z"
    durationMs: 300000
    costUsd: 1.5
    nog_verdict: "APENDMENT_REQUIRED"
    nog_reason: "Missing tests in round 1"
  - round: 2
    done_at: "2026-04-19T12:00:00.000Z"
    durationMs: 250000
    costUsd: 1.2
    nog_verdict: "APENDMENT_REQUIRED"
    nog_reason: "Still missing edge case"
  - round: 3
    done_at: "2026-04-19T14:00:00.000Z"
    durationMs: 200000
    costUsd: 1.0
    nog_verdict: "ACCEPTED"
    nog_reason: "All good"
---`;
writeQueue('905-PARKED.md', parkedFm + `
## Original brief

This is the brief content.

## Round 2 — Rework
Rom round 2 report here.

## Nog Review — Round 2
Nog says: still missing edge case.

## Round 3 — Rework
Rom round 3 final report.

## Nog Review — Round 3
All good, accepted.
`);

// 906: STUCK (5-round like 185)
const stuckFm = `---
id: "906"
title: "Test STUCK 5-round"
status: STUCK
rounds:
  - round: 1
    done_at: "2026-04-18T10:00:00.000Z"
    durationMs: 400000
    costUsd: 2.0
    nog_verdict: "APENDMENT_REQUIRED"
    nog_reason: "Round 1 fail"
  - round: 2
    done_at: "2026-04-18T12:00:00.000Z"
    durationMs: 350000
    costUsd: 1.8
    nog_verdict: "APENDMENT_REQUIRED"
    nog_reason: "Round 2 fail"
  - round: 3
    done_at: "2026-04-18T14:00:00.000Z"
    durationMs: 300000
    costUsd: 1.5
    nog_verdict: "APENDMENT_REQUIRED"
    nog_reason: "Round 3 fail"
  - round: 4
    done_at: "2026-04-18T16:00:00.000Z"
    durationMs: 280000
    costUsd: 1.4
    nog_verdict: "APENDMENT_REQUIRED"
    nog_reason: "Round 4 fail"
  - round: 5
    done_at: "2026-04-18T18:00:00.000Z"
    durationMs: 260000
    costUsd: 1.3
    nog_verdict: "ESCALATE"
    nog_reason: "Escalated after 5 rounds"
---`;
writeQueue('906-STUCK.md', stuckFm + '\n\nStuck slice full body here.\n');

// 907: ERROR
writeQueue('907-ERROR.md', frontmatter({ id: '907', status: 'ERROR', reason: 'non_zero_exit' }) + '\n\nError slice body (watcher-written).\n');

// ---------------------------------------------------------------------------
// Import server module (does NOT listen because of require.main guard)
// ---------------------------------------------------------------------------

const { buildSliceInvestigation } = require(path.join(REPO_ROOT, 'dashboard', 'server'));

// ---------------------------------------------------------------------------
// Part 1: Static analysis — server.js
// ---------------------------------------------------------------------------

console.log('\n== Slice investigation tests (slice 189) ==\n');
console.log('--- Part 1: Static analysis — server.js ---');

test('/api/slice/:id route uses numeric-only regex', () => {
  assert.ok(
    serverSource.includes("/^\\/api\\/slice\\/(\\d+)$/") ||
    serverSource.match(/api\/slice.*\\(\\\\d\+\\).*\$/),
    'server.js must have /api/slice/(\\d+)$ regex'
  );
});

test('400 handler for non-numeric /api/slice/* present', () => {
  assert.ok(
    serverSource.includes("startsWith('/api/slice/')") ||
    serverSource.includes('Slice ID must be numeric'),
    'server.js must return 400 for non-numeric slice IDs'
  );
});

test('buildSliceInvestigation exported from server.js', () => {
  assert.ok(
    serverSource.includes('buildSliceInvestigation'),
    'server.js must define buildSliceInvestigation'
  );
  assert.ok(
    serverSource.includes("module.exports"),
    'server.js must export buildSliceInvestigation'
  );
});

// ---------------------------------------------------------------------------
// Part 2: Integration tests — file resolution logic
// ---------------------------------------------------------------------------

console.log('\n--- Part 2: File resolution via buildSliceInvestigation ---');

const dirs = { queueDir: QUEUE, stagedDir: STAGED };

test('STAGED-only: prompt = STAGED body, report = null, reviews = []', () => {
  const result = buildSliceInvestigation('901', dirs);
  assert.ok(result.prompt && result.prompt.includes('Original brief body here'), 'prompt should contain STAGED body');
  assert.strictEqual(result.report, null, 'report should be null for STAGED-only');
  assert.deepStrictEqual(result.reviews, [], 'reviews should be [] for STAGED-only');
});

test('IN_PROGRESS: prompt = IN_PROGRESS body', () => {
  const result = buildSliceInvestigation('902', dirs);
  assert.ok(result.prompt && result.prompt.includes('Brief for in-progress slice'), 'prompt from IN_PROGRESS file');
  assert.strictEqual(result.report, null, 'no terminal file yet');
});

test('DONE single-round (no NOG.md): reviews = []', () => {
  const result = buildSliceInvestigation('903', dirs);
  assert.ok(result.report && result.report.includes('Rom report for single-round'), 'report = DONE body');
  assert.deepStrictEqual(result.reviews, [], 'reviews empty without NOG.md');
});

test('DONE + NOG.md: reviews.length === 1, round=1, nog_review set', () => {
  const result = buildSliceInvestigation('904', dirs);
  assert.strictEqual(result.reviews.length, 1, 'one review from NOG.md');
  assert.strictEqual(result.reviews[0].round, 1, 'round = 1');
  assert.strictEqual(result.reviews[0].verdict, 'ACCEPTED', 'verdict from NOG.md frontmatter');
  assert.ok(result.reviews[0].nog_review && result.reviews[0].nog_review.includes('Nog review text'), 'nog_review body populated');
});

test('PARKED multi-round: reviews.length === 3, done_at + verdict populated', () => {
  const result = buildSliceInvestigation('905', dirs);
  assert.strictEqual(result.reviews.length, 3, 'three rounds from PARKED rounds[]');
  assert.strictEqual(result.reviews[0].round, 1);
  assert.strictEqual(result.reviews[1].round, 2);
  assert.strictEqual(result.reviews[2].round, 3);
  assert.ok(result.reviews[0].done_at, 'done_at populated for round 1');
  assert.strictEqual(result.reviews[0].verdict, 'APENDMENT_REQUIRED', 'verdict from frontmatter');
  assert.strictEqual(result.reviews[2].verdict, 'ACCEPTED', 'last round accepted');
  assert.ok(result.reviews[0].durationMs === 300000, 'durationMs populated');
});

test('PARKED multi-round: nog_review per round from body sections', () => {
  const result = buildSliceInvestigation('905', dirs);
  // Round 2 nog_review should come from body extraction
  assert.ok(result.reviews[1].nog_review, 'nog_review for round 2 populated');
  // Round 3 rom_report from body
  assert.ok(result.reviews[2].rom_report, 'rom_report for round 3 populated');
});

test('STUCK 5-round: reviews.length === 5, report = STUCK body', () => {
  const result = buildSliceInvestigation('906', dirs);
  assert.strictEqual(result.reviews.length, 5, 'five rounds from STUCK file');
  assert.ok(result.report && result.report.includes('Stuck slice full body'), 'report = STUCK body');
  assert.strictEqual(result.reviews[4].verdict, 'ESCALATE', 'last round escalated');
  assert.ok(result.reviews[4].done_at, 'done_at for round 5');
});

test('ERROR: report = ERROR body', () => {
  const result = buildSliceInvestigation('907', dirs);
  assert.ok(result.report && result.report.includes('Error slice body'), 'report = ERROR body');
});

test('Unknown ID → throws with status 404', () => {
  let threw = false;
  try {
    buildSliceInvestigation('999', dirs);
  } catch (e) {
    threw = true;
    assert.strictEqual(e.status, 404, 'error.status should be 404');
  }
  assert.ok(threw, 'should have thrown for unknown ID');
});

// ---------------------------------------------------------------------------
// Part 3: Path traversal — static analysis
// ---------------------------------------------------------------------------

console.log('\n--- Part 3: Path traversal / input validation ---');

test('Numeric regex rejects path traversal (../../etc/passwd)', () => {
  // The route uses /^\/api\/slice\/(\d+)$/ which only matches digits.
  // A traversal attempt like "../../etc/passwd" does not match \d+.
  const routeRegex = /^\/api\/slice\/(\d+)$/;
  assert.ok(!routeRegex.test('/api/slice/../../etc/passwd'), 'traversal path must not match route regex');
  assert.ok(!routeRegex.test('/api/slice/abc'), 'alpha ID must not match');
  assert.ok( routeRegex.test('/api/slice/123'),  'numeric ID must match');
});

test('400 response path present for non-numeric IDs', () => {
  assert.ok(
    serverSource.includes("startsWith('/api/slice/')"),
    'must have catch-all 400 handler for /api/slice/*'
  );
});

// ---------------------------------------------------------------------------
// Part 4: Dashboard HTML structure
// ---------------------------------------------------------------------------

console.log('\n--- Part 4: Dashboard HTML structure ---');

test('inv-panel-overlay element present', () => {
  assert.ok(dashSource.includes('id="inv-panel-overlay"'), 'investigation panel overlay must exist');
});

test('Three inv-pane divs: prompt, report, review', () => {
  assert.ok(dashSource.includes('id="inv-pane-prompt"'), 'prompt pane required');
  assert.ok(dashSource.includes('id="inv-pane-report"'), 'report pane required');
  assert.ok(dashSource.includes('id="inv-pane-review"'), 'review pane required');
});

test('Three tab buttons present', () => {
  assert.ok(dashSource.includes("data-tab=\"prompt\""), 'prompt tab required');
  assert.ok(dashSource.includes("data-tab=\"report\""), 'report tab required');
  assert.ok(dashSource.includes("data-tab=\"review\""), 'review tab required');
});

test('AC 4 — accordion rendered in BOTH rom report AND nog review panes', () => {
  // renderInvAccordion called with mode 'rom' for report pane
  const reportAccordion = dashSource.includes("renderInvAccordion(data.reviews, 'rom')");
  const reviewAccordion = dashSource.includes("renderInvAccordion(data.reviews, 'nog')");
  assert.ok(reportAccordion, 'Rom Report pane must call renderInvAccordion with mode "rom"');
  assert.ok(reviewAccordion, 'Nog Review pane must call renderInvAccordion with mode "nog"');
});

test('renderInvAccordion produces <details> per round', () => {
  assert.ok(dashSource.includes('class="inv-round"'), 'accordion uses inv-round class on details');
  assert.ok(dashSource.includes('<details class="inv-round"'), 'details element used for accordion');
});

test('Multi-round guard: reviews.length > 1 triggers accordion for rom report', () => {
  assert.ok(
    dashSource.includes("data.reviews.length > 1") &&
    dashSource.includes("renderInvAccordion"),
    'must check reviews.length > 1 before rendering accordion'
  );
});

test('queue-list event delegation wired', () => {
  assert.ok(
    dashSource.includes("document.getElementById('queue-list').addEventListener"),
    'queue-list must have click delegation'
  );
});

test('history-list event delegation wired', () => {
  assert.ok(
    dashSource.includes("document.getElementById('history-list').addEventListener"),
    'history-list must have click delegation'
  );
});

test('Esc key closes panel', () => {
  assert.ok(
    dashSource.includes("e.key === 'Escape' && invPanelOpen"),
    'Escape key must close investigation panel'
  );
});

test('Backdrop click closes panel', () => {
  assert.ok(
    dashSource.includes("e.target === e.currentTarget") &&
    dashSource.includes("closeInvPanel"),
    'backdrop click must close investigation panel'
  );
});

// ---------------------------------------------------------------------------
// Part 5: No dead imports
// ---------------------------------------------------------------------------

console.log('\n--- Part 5: No dead imports ---');

test('No dead require imports in this test file', () => {
  const testSrc = fs.readFileSync(__filename, 'utf8');
  // Every top-level require must be used in the file body
  const requires = [...testSrc.matchAll(/^const\s+(\w+)\s*=\s*require\(/mg)].map(m => m[1]);
  const used = requires.filter(name => {
    const body = testSrc.replace(/^const\s+\w+\s*=\s*require\([^)]+\);/mg, '');
    return body.includes(name);
  });
  assert.strictEqual(used.length, requires.length, `All required names must be used. Required: ${requires}, used: ${used}`);
});

// ---------------------------------------------------------------------------
// Cleanup + summary
// ---------------------------------------------------------------------------

process.on('exit', () => {
  // Remove temp files
  try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
  if (failed > 0) process.exitCode = 1;
});
