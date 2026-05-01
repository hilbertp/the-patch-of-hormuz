'use strict';

/**
 * accept-and-merge-deferred-during-gate.test.js — Slice 273
 *
 * With gate-running.json present (synthetic mutex held), accept a slice;
 * verify NO squash, branch-state.dev.deferred_slices has the entry,
 * SLICE_DEFERRED event in register.
 *
 * Run: node test/accept-and-merge-deferred-during-gate.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  acceptAndMerge,
  _testSetRegisterFile,
  _testSetDirs,
  _testSetProjectDir,
} = require('../bridge/orchestrator');

const MUTEX_PATH = path.resolve(__dirname, '..', 'bridge', 'state', 'gate-running.json');
const BRANCH_STATE_PATH = path.resolve(__dirname, '..', 'bridge', 'state', 'branch-state.json');

let passed = 0;
let failed = 0;
let originalBranchState;

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

function setup() {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'defer-test-'));
  const queueDir = path.join(tmp, 'queue');
  const stagedDir = path.join(tmp, 'staged');
  const trashDir = path.join(tmp, 'trash');
  const regFile = path.join(tmp, 'register.jsonl');

  fs.mkdirSync(queueDir, { recursive: true });
  fs.mkdirSync(stagedDir, { recursive: true });
  fs.mkdirSync(trashDir, { recursive: true });
  fs.writeFileSync(regFile, '', 'utf8');

  // Save original branch-state
  originalBranchState = fs.readFileSync(BRANCH_STATE_PATH, 'utf-8');

  // Set up branch-state with empty deferred_slices
  const branchState = {
    gate: { status: 'GATE_RUNNING' },
    dev: { tip_sha: 'abc123', tip_ts: '2026-01-01T00:00:00Z', commits_ahead_of_main: 1, commits: [], deferred_slices: [] },
  };
  fs.writeFileSync(BRANCH_STATE_PATH, JSON.stringify(branchState, null, 2));

  // Create gate-running.json (mutex held)
  fs.writeFileSync(MUTEX_PATH, JSON.stringify({
    schema_version: 1,
    started_ts: new Date().toISOString(),
    dev_tip_sha: 'abc123',
    bashir_pid: process.pid,
    bashir_heartbeat_path: 'bridge/state/bashir-heartbeat.json',
  }, null, 2));

  // Write EVALUATING file
  const evalContent = [
    '---',
    'id: "099"',
    'title: "Deferred test slice"',
    'branch: "slice/099"',
    'status: "EVALUATING"',
    '---',
    '',
    '## Body',
  ].join('\n');
  fs.writeFileSync(path.join(queueDir, '099-EVALUATING.md'), evalContent);

  _testSetRegisterFile(regFile);
  _testSetDirs(queueDir, stagedDir, trashDir);

  const cleanup = () => {
    try { fs.unlinkSync(MUTEX_PATH); } catch (_) {}
    fs.writeFileSync(BRANCH_STATE_PATH, originalBranchState, 'utf-8');
    fs.rmSync(tmp, { recursive: true, force: true });
  };

  return { tmp, queueDir, regFile, cleanup };
}

function readRegEvents(regFile) {
  try {
    return fs.readFileSync(regFile, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) { return []; }
}

console.log('\naccept-and-merge-deferred-during-gate tests (slice 273)');

test('A — Gate running: slice is deferred, not squashed', () => {
  const { queueDir, regFile, cleanup } = setup();
  try {
    const evalPath = path.join(queueDir, '099-EVALUATING.md');
    const result = acceptAndMerge('099', evalPath, 'slice/099', 'Deferred test slice');

    assert.strictEqual(result.deferred, true, 'Result should indicate deferred');
    assert.strictEqual(result.success, true, 'Deferred is still a success');
    assert.strictEqual(result.sha, null, 'No sha for deferred slice');

    // Verify deferred_slices has the entry
    const state = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
    assert.ok(Array.isArray(state.dev.deferred_slices), 'deferred_slices should be an array');
    assert.strictEqual(state.dev.deferred_slices.length, 1, 'Should have one deferred entry');
    assert.strictEqual(state.dev.deferred_slices[0].slice_id, '099', 'Deferred entry should have correct slice_id');
    assert.ok(state.dev.deferred_slices[0].accepted_ts, 'Deferred entry should have accepted_ts');

    // Verify SLICE_DEFERRED in register
    const events = readRegEvents(regFile);
    const deferEvent = events.find(e => e.event === 'SLICE_DEFERRED');
    assert.ok(deferEvent, 'Register should have SLICE_DEFERRED event');
    assert.strictEqual(deferEvent.slice_id, '099', 'SLICE_DEFERRED should reference correct slice');
    assert.strictEqual(deferEvent.reason, 'gate-running', 'Reason should be gate-running');

    // Verify ACCEPTED file exists (rename happened)
    assert.ok(fs.existsSync(path.join(queueDir, '099-ACCEPTED.md')), 'ACCEPTED file should exist');

    // Verify NO SLICE_SQUASHED_TO_DEV event
    const squashEvent = events.find(e => e.event === 'SLICE_SQUASHED_TO_DEV');
    assert.ok(!squashEvent, 'Should NOT have SLICE_SQUASHED_TO_DEV event');
  } finally {
    cleanup();
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
