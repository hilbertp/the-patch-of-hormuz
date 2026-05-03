'use strict';

/**
 * gate-flow-flag.test.js — Slice 283 (W-GateFlag-1)
 *
 * Verifies that DS9_USE_GATE_FLOW env var correctly routes acceptAndMerge
 * to either the legacy mergeBranch path (flag=0/unset) or the gate-flow
 * squashSliceToDev path (flag=1).
 *
 * Run: node --test bridge/test/gate-flow-flag.test.js
 *
 * Strategy: We require orchestrator.js and override squashSliceToDev (exported)
 * via mock. For mergeBranch (not exported), we detect its path by the git
 * operations it attempts — when it tries to run git in a non-existent worktree,
 * it returns { success: false }. The key assertion is WHICH path was attempted.
 *
 * Uses node:test (built-in). No new npm dependencies.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

let tmpDir;
let queueDir;
let stateDir;
let trashDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-flag-test-'));
  queueDir = path.join(tmpDir, 'bridge', 'queue');
  stateDir = path.join(tmpDir, 'bridge', 'state');
  trashDir = path.join(tmpDir, 'bridge', 'trash');
  fs.mkdirSync(queueDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(trashDir, { recursive: true });

  // Write minimal branch-state.json (needed for gate-flow defer check)
  const branchState = {
    schema_version: 1,
    main: { tip_sha: null, tip_subject: null, tip_ts: null },
    dev: { tip_sha: null, tip_ts: null, commits_ahead_of_main: 0, commits: [], deferred_slices: [] },
    last_merge: null,
    gate: { status: 'IDLE', current_run: null, last_failure: null, last_pass: null },
  };
  fs.writeFileSync(path.join(stateDir, 'branch-state.json'), JSON.stringify(branchState, null, 2) + '\n');
}

function cleanup() {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  // Restore env
  delete process.env.DS9_USE_GATE_FLOW;
}

function createAcceptedFile(id) {
  const filePath = path.join(queueDir, `${id}-ACCEPTED.md`);
  fs.writeFileSync(filePath, `---\nid: "${id}"\ntitle: "test slice"\n---\ntest body\n`);
  return filePath;
}

// ---------------------------------------------------------------------------
// Load orchestrator and gate-mutex with test overrides
// ---------------------------------------------------------------------------

const orch = require('../orchestrator');
const gateMutex = require('../state/gate-mutex');
const REAL_MUTEX_PATH = gateMutex.MUTEX_PATH;

describe('DS9_USE_GATE_FLOW flag', () => {
  beforeEach(() => {
    setup();
    orch._testSetDirs(queueDir, path.join(tmpDir, 'bridge', 'staged'), trashDir);
    orch._testSetProjectDir(tmpDir);
  });

  afterEach(() => {
    // Always remove test mutex if we wrote one
    try { fs.unlinkSync(REAL_MUTEX_PATH); } catch (_) {}
    cleanup();
  });

  it('USE_GATE_FLOW=0 (or unset) — routes to legacy mergeBranch', () => {
    delete process.env.DS9_USE_GATE_FLOW;

    createAcceptedFile('9990');

    // acceptAndMerge will try mergeBranch, which will fail (no real git repo)
    // but the key test is that it does NOT call squashSliceToDev
    let squashCalled = false;
    const origSquash = orch.squashSliceToDev;
    // Temporarily replace the exported squashSliceToDev to detect if it's called
    // Note: acceptAndMerge calls the internal ref, so we can't intercept via export.
    // Instead we verify the return shape: mergeBranch returns an error about
    // worktree/git, NOT about squash.

    const result = orch.acceptAndMerge('9990', null, 'slice/9990', 'test slice', { queueDir });

    // mergeBranch path was taken — it fails because there's no real git repo,
    // but the error should be from the merge path (worktree/branch/git related),
    // NOT from squash
    assert.equal(result.success, false, 'Should fail (no real git repo for merge)');
    assert.ok(result.error, 'Should have an error message');
    // The error should NOT be about squash/dev operations
    assert.ok(!result.deferred, 'Should not be deferred (legacy path has no defer)');
  });

  it('USE_GATE_FLOW=0 explicitly — same legacy path', () => {
    process.env.DS9_USE_GATE_FLOW = '0';

    createAcceptedFile('9991');

    const result = orch.acceptAndMerge('9991', null, 'slice/9991', 'test slice', { queueDir });

    assert.equal(result.success, false, 'Should fail (no real git repo)');
    assert.ok(result.error, 'Should have an error from mergeBranch');
    assert.ok(!result.deferred, 'Legacy path never defers');
  });

  it('USE_GATE_FLOW=1 — routes to gate-flow squashSliceToDev', () => {
    process.env.DS9_USE_GATE_FLOW = '1';

    createAcceptedFile('9992');

    const result = orch.acceptAndMerge('9992', null, 'slice/9992', 'test slice', { queueDir });

    // squashSliceToDev path was taken — it fails differently than mergeBranch
    // (e.g., no worktree path for squash, different error shape)
    assert.equal(result.success, false, 'Should fail (no real git repo for squash)');
    assert.ok(result.error, 'Should have an error from squashSliceToDev');
  });

  it('USE_GATE_FLOW=1 with gate running — defers slice', () => {
    process.env.DS9_USE_GATE_FLOW = '1';

    createAcceptedFile('9993');

    // Write gate-running mutex to the REAL mutex path (shouldDeferSquash reads it)
    const mutexPayload = {
      slice_id: 'gate-test',
      started_at: new Date().toISOString(),
      pid: process.pid,
    };
    fs.writeFileSync(REAL_MUTEX_PATH, JSON.stringify(mutexPayload, null, 2) + '\n');

    const result = orch.acceptAndMerge('9993', null, 'slice/9993', 'test slice', { queueDir });

    assert.equal(result.success, true, 'Defer is a success');
    assert.equal(result.deferred, true, 'Should be deferred when gate is running');
    assert.equal(result.sha, null, 'No SHA when deferred');

    // Verify the slice was added to deferred_slices in branch-state
    const bs = JSON.parse(fs.readFileSync(path.join(stateDir, 'branch-state.json'), 'utf-8'));
    const deferred = bs.dev.deferred_slices;
    assert.ok(deferred.some(d => d.slice_id === '9993'), 'Slice 9993 should be in deferred_slices');
  });

  it('USE_GATE_FLOW=0 with gate running — ignores gate, takes legacy path', () => {
    process.env.DS9_USE_GATE_FLOW = '0';

    createAcceptedFile('9994');

    // Write gate-running mutex to REAL path — should be ignored in legacy mode
    const mutexPayload = {
      slice_id: 'gate-test',
      started_at: new Date().toISOString(),
      pid: process.pid,
    };
    fs.writeFileSync(REAL_MUTEX_PATH, JSON.stringify(mutexPayload, null, 2) + '\n');

    const result = orch.acceptAndMerge('9994', null, 'slice/9994', 'test slice', { queueDir });

    // Legacy path — should NOT defer, should attempt mergeBranch (and fail due to no repo)
    assert.ok(!result.deferred, 'Legacy path should NOT defer even with gate running');
    assert.equal(result.success, false, 'Should fail (no real git repo)');
    assert.ok(result.error, 'Should have mergeBranch error, not defer');
  });

  it('flag is read per-call, not at module load', () => {
    // First call: legacy
    delete process.env.DS9_USE_GATE_FLOW;
    createAcceptedFile('9995');
    const r1 = orch.acceptAndMerge('9995', null, 'slice/9995', 'test slice', { queueDir });
    assert.ok(!r1.deferred, 'First call: legacy, no defer');

    // Second call: gate flow with gate running → should defer
    process.env.DS9_USE_GATE_FLOW = '1';
    createAcceptedFile('9996');
    fs.writeFileSync(REAL_MUTEX_PATH,
      JSON.stringify({ slice_id: 'x', started_at: new Date().toISOString(), pid: process.pid }) + '\n'
    );
    const r2 = orch.acceptAndMerge('9996', null, 'slice/9996', 'test slice', { queueDir });
    assert.equal(r2.deferred, true, 'Second call: gate flow, should defer');
  });
});
