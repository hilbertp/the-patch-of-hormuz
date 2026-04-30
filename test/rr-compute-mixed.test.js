'use strict';

/**
 * rr-compute-mixed.test.js — Slice 270
 *
 * Synthetic 6-slice dev with a mix of high-risk and low-risk telemetry,
 * partial AC coverage. Verifies RR value falls in the expected range.
 *
 * Run: node test/rr-compute-mixed.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { computeRR, _testSetPaths } = require('../bridge/rr-compute');

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
    if (err.stack) console.log(`    ${err.stack.split('\n').slice(1, 3).join('\n    ')}`);
  }
}

const TEST_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rr-mixed-'));
const BRANCH_STATE_PATH = path.join(TEST_DIR, 'branch-state.json');
const REGISTER_PATH = path.join(TEST_DIR, 'register.jsonl');
const QUEUE_DIR = path.join(TEST_DIR, 'queue');
const REGRESSION_DIR = path.join(TEST_DIR, 'regression');

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (_) {}
}

function setupMixed() {
  fs.mkdirSync(QUEUE_DIR, { recursive: true });
  fs.mkdirSync(REGRESSION_DIR, { recursive: true });

  // 6 slices on dev
  const commits = [];
  for (let i = 1; i <= 6; i++) {
    commits.push({ sha: `sha${i}`, slice_id: String(i), title: `Slice ${i}`, ts: '2026-04-01T00:00:00Z' });

    // Create slice files with ACs (3 ACs each = 18 total)
    fs.writeFileSync(path.join(QUEUE_DIR, `${i}-PARKED.md`), `---
id: "${i}"
title: "Slice ${i}"
---

## Acceptance criteria

1. AC one
2. AC two
3. AC three
`);
  }

  // branch-state with 6 commits
  fs.writeFileSync(BRANCH_STATE_PATH, JSON.stringify({
    schema_version: 1,
    main: { tip_sha: 'main0', tip_subject: 'initial', tip_ts: '2026-01-01T00:00:00Z' },
    dev: { tip_sha: 'sha6', tip_ts: '2026-04-01T00:00:00Z', commits_ahead_of_main: 6, commits, deferred_slices: [] },
    last_merge: null,
    gate: { status: 'IDLE', current_run: null, last_failure: null, last_pass: null },
  }, null, 2) + '\n');

  // NOG_TELEMETRY events: slices 1-3 high-risk, slices 4-6 low-risk
  const events = [];
  for (let i = 1; i <= 3; i++) {
    events.push(JSON.stringify({
      ts: '2026-04-01T00:00:00Z',
      event: 'NOG_TELEMETRY',
      slice_id: String(i),
      rounds: 3,
      files_touched: ['bridge/orchestrator.js'],
      high_risk_surface: true,
      lint_findings_total: 4,
      ac_count: 3,
      escalated: false,
    }));
  }
  for (let i = 4; i <= 6; i++) {
    events.push(JSON.stringify({
      ts: '2026-04-01T00:00:00Z',
      event: 'NOG_TELEMETRY',
      slice_id: String(i),
      rounds: 1,
      files_touched: ['README.md'],
      high_risk_surface: false,
      lint_findings_total: 0,
      ac_count: 3,
      escalated: false,
    }));
  }
  fs.writeFileSync(REGISTER_PATH, events.join('\n') + '\n');

  // Partial AC coverage: cover 9 out of 18 ACs (50%)
  for (let i = 1; i <= 3; i++) {
    for (let ac = 1; ac <= 3; ac++) {
      fs.writeFileSync(path.join(REGRESSION_DIR, `slice-${i}-ac-${ac}.test.js`), '');
    }
  }
  // Slices 4-6 have NO coverage → 9 uncovered ACs

  _testSetPaths({
    branchStatePath: BRANCH_STATE_PATH,
    registerPath: REGISTER_PATH,
    queueDir: QUEUE_DIR,
    regressionDir: REGRESSION_DIR,
  });
}

console.log('\n-- rr-compute-mixed tests --');

// ---------------------------------------------------------------------------
// 1. Mixed 6-slice dev: RR in expected range (30-50)
// ---------------------------------------------------------------------------
test('6-slice mixed dev: RR is in expected range', () => {
  setupMixed();

  const result = computeRR();

  // slice_pressure = min(1.0, 6/10) = 0.6
  // surface_volatility: 3 high-risk (score 1.0+0.3+0.2=1.5 each) + 3 low-risk (score 0)
  //   sum = 4.5, max = 6*2.0 = 12, normalized = 0.375
  // ac_coverage_gap: 1 - (9/18) = 0.5
  // RR = round(100 * (0.30*0.6 + 0.50*0.375 + 0.20*0.5))
  //    = round(100 * (0.18 + 0.1875 + 0.10))
  //    = round(100 * 0.4675)
  //    = round(46.75) = 47

  assert.ok(result.rr >= 30, `Expected rr >= 30, got ${result.rr}`);
  assert.ok(result.rr <= 55, `Expected rr <= 55, got ${result.rr}`);
  assert.strictEqual(result.band, 'amber', `Expected band=amber, got ${result.band}`);
  assert.ok(result.inputs.slice_pressure > 0, 'slice_pressure should be > 0');
  assert.ok(result.inputs.surface_volatility > 0, 'surface_volatility should be > 0');
  assert.ok(result.inputs.ac_coverage_gap > 0, 'ac_coverage_gap should be > 0');
});

// ---------------------------------------------------------------------------
// 2. Sanity: 10 high-risk slices, 0 coverage → RR near 100
// ---------------------------------------------------------------------------
test('10 high-risk slices, 0 AC coverage → RR near 100', () => {
  // Override with extreme scenario
  const commits = [];
  for (let i = 100; i < 110; i++) {
    commits.push({ sha: `sha${i}`, slice_id: String(i), title: `Slice ${i}`, ts: '2026-04-01T00:00:00Z' });
    fs.writeFileSync(path.join(QUEUE_DIR, `${i}-PARKED.md`), `---
id: "${i}"
title: "Slice ${i}"
---

## Acceptance criteria

1. AC one
2. AC two
`);
  }

  fs.writeFileSync(BRANCH_STATE_PATH, JSON.stringify({
    schema_version: 1,
    main: { tip_sha: 'main0' },
    dev: { tip_sha: 'sha109', commits_ahead_of_main: 10, commits, deferred_slices: [] },
  }, null, 2) + '\n');

  const events = [];
  for (let i = 100; i < 110; i++) {
    events.push(JSON.stringify({
      ts: '2026-04-01T00:00:00Z',
      event: 'NOG_TELEMETRY',
      slice_id: String(i),
      rounds: 4,
      files_touched: ['bridge/orchestrator.js', 'bridge/state/gate-mutex.js'],
      high_risk_surface: true,
      lint_findings_total: 5,
      ac_count: 2,
      escalated: true,
    }));
  }
  fs.writeFileSync(REGISTER_PATH, events.join('\n') + '\n');

  const result = computeRR();

  // slice_pressure = 1.0, surface_volatility = 1.0, ac_coverage_gap = 1.0
  // RR = round(100 * (0.30 + 0.50 + 0.20)) = 100
  assert.ok(result.rr >= 90, `Expected rr >= 90, got ${result.rr}`);
  assert.strictEqual(result.band, 'red', `Expected band=red, got ${result.band}`);
});

// ---------------------------------------------------------------------------
// 3. Sanity: 0 commits → rr=0
// ---------------------------------------------------------------------------
test('0 commits → rr=0', () => {
  fs.writeFileSync(BRANCH_STATE_PATH, JSON.stringify({
    schema_version: 1,
    dev: { commits: [] },
  }, null, 2) + '\n');

  const result = computeRR();
  assert.strictEqual(result.rr, 0);
  assert.strictEqual(result.band, 'green');
});

cleanup();

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
