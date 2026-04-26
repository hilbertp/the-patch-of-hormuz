'use strict';

/**
 * orchestrator-push-verify.test.js — Slice 224
 *
 * Regression tests for verifyOriginAdvanced (W1 push-verify guard):
 *   A — happy path: ls-remote returns matching SHA → { ok: true }
 *   B — mismatch: ls-remote returns different SHA → { ok: false, reason }
 *   C — MERGE_NOT_PUSHED event + .pipeline-paused flag on mismatch (source check)
 *   D — mergeBranch returns failure on mismatch (source check)
 *   E — dispatch loop skips when .pipeline-paused exists
 *
 * Run: node test/orchestrator-push-verify.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const os = require('os');

const BRIDGE_DIR = path.join(__dirname, '..', 'bridge');
const gitFinalizer = require('../bridge/git-finalizer');
const { verifyOriginAdvanced } = require('../bridge/orchestrator.js');

const orchestratorSource = fs.readFileSync(
  path.join(BRIDGE_DIR, 'orchestrator.js'),
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

const originalRunGit = gitFinalizer.runGit;
function restoreRunGit() { gitFinalizer.runGit = originalRunGit; }

// ---------------------------------------------------------------------------
// A — happy path: ls-remote returns matching SHA
// ---------------------------------------------------------------------------

console.log('\n-- verifyOriginAdvanced unit tests --');

test('A — matching SHA: ls-remote returns same SHA → { ok: true }', () => {
  const sha = 'abc1234def5678901234567890abcdef12345678';
  gitFinalizer.runGit = function (cmd) {
    if (cmd.includes('ls-remote origin main')) {
      return sha + '\trefs/heads/main\n';
    }
    return '';
  };
  const result = verifyOriginAdvanced('test-A', sha);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.originSha, sha);
  assert.strictEqual(result.reason, null);
  restoreRunGit();
});

// ---------------------------------------------------------------------------
// B — mismatch: ls-remote returns different SHA
// ---------------------------------------------------------------------------

test('B — mismatch: ls-remote returns different SHA → { ok: false }', () => {
  const localSha = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
  const remoteSha = 'ffff6666777788889999aaaa0000bbbb1111cccc';
  gitFinalizer.runGit = function (cmd) {
    if (cmd.includes('ls-remote origin main')) {
      return remoteSha + '\trefs/heads/main\n';
    }
    return '';
  };
  const result = verifyOriginAdvanced('test-B', localSha);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.originSha, remoteSha);
  assert.strictEqual(result.reason, 'push_succeeded_but_remote_did_not_advance');
  restoreRunGit();
});

test('B2 — ls-remote failure → { ok: false, reason starts with ls_remote_failed }', () => {
  gitFinalizer.runGit = function (cmd) {
    if (cmd.includes('ls-remote origin main')) {
      throw new Error('network timeout');
    }
    return '';
  };
  const result = verifyOriginAdvanced('test-B2', 'someSha');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.originSha, null);
  assert.ok(result.reason.startsWith('ls_remote_failed'), `reason should start with ls_remote_failed, got: ${result.reason}`);
  restoreRunGit();
});

// ---------------------------------------------------------------------------
// C — source-level: MERGE_NOT_PUSHED event + .pipeline-paused on mismatch
// ---------------------------------------------------------------------------

console.log('\n-- Source-level integration checks --');

test('C — MERGE_NOT_PUSHED registerEvent emitted with required payload fields', () => {
  const eventCall = orchestratorSource.indexOf("registerEvent(id, 'MERGE_NOT_PUSHED'");
  assert.ok(eventCall > 0, 'MERGE_NOT_PUSHED registerEvent call must exist');

  // The payload is built just above the registerEvent call — look at a wider window
  const payloadStart = orchestratorSource.lastIndexOf('const payload', eventCall);
  assert.ok(payloadStart > 0, 'payload variable must exist before registerEvent');
  const payloadBlock = orchestratorSource.substring(payloadStart, eventCall + 100);
  assert.ok(payloadBlock.includes('local_sha'), 'payload must include local_sha');
  assert.ok(payloadBlock.includes('origin_sha'), 'payload must include origin_sha');
  assert.ok(payloadBlock.includes('reason'), 'payload must include reason');
  assert.ok(payloadBlock.includes('slice_id'), 'payload must include slice_id');
});

test('C2 — .pipeline-paused flag written on mismatch path', () => {
  const pauseWrite = orchestratorSource.indexOf('PIPELINE_PAUSED_FILE');
  assert.ok(pauseWrite > 0, 'PIPELINE_PAUSED_FILE must be referenced');

  // Verify writeFileSync is called with PIPELINE_PAUSED_FILE in the mismatch path
  const mergeBranchStart = orchestratorSource.indexOf('function mergeBranch(');
  const mergeBranchBody = orchestratorSource.substring(mergeBranchStart);
  assert.ok(mergeBranchBody.includes('writeFileSync(PIPELINE_PAUSED_FILE'), '.pipeline-paused must be written via writeFileSync');
  assert.ok(mergeBranchBody.includes('MERGE_NOT_PUSHED'), 'payload must include MERGE_NOT_PUSHED event name');
});

// ---------------------------------------------------------------------------
// D — mergeBranch returns failure on mismatch, does NOT emit MERGED
// ---------------------------------------------------------------------------

test('D — mergeBranch returns merge_not_pushed failure on verify mismatch', () => {
  const mergeBranchStart = orchestratorSource.indexOf('function mergeBranch(');
  const mergeBranchBody = orchestratorSource.substring(mergeBranchStart);

  const failReturn = mergeBranchBody.indexOf("return { success: false, sha: null, error: 'merge_not_pushed' }");
  assert.ok(failReturn > 0, 'merge_not_pushed return must exist in mergeBranch');

  // Verify it comes after the push
  const pushCall = mergeBranchBody.indexOf("git push origin main");
  assert.ok(failReturn > pushCall, 'merge_not_pushed return must come after push call');

  // Verify the verify call exists and precedes the failure return
  const verifyIdx = mergeBranchBody.indexOf('verifyOriginAdvanced(id, newSha)');
  assert.ok(verifyIdx > 0, 'verifyOriginAdvanced call must exist');
  assert.ok(verifyIdx < failReturn, 'verify must come before failure return');
});

test('D2 — verifyOriginAdvanced called between push and final success return', () => {
  const mergeBranchStart = orchestratorSource.indexOf('function mergeBranch(');
  const mergeBranchBody = orchestratorSource.substring(mergeBranchStart);

  const pushIdx = mergeBranchBody.indexOf("git push origin main");
  const verifyIdx = mergeBranchBody.indexOf('verifyOriginAdvanced(id, newSha)');

  // Find the success return AFTER the verify call (the final one)
  const successReturnIdx = mergeBranchBody.indexOf("return { success: true, sha: newSha, error: null }", verifyIdx);

  assert.ok(pushIdx > 0, 'push must exist');
  assert.ok(verifyIdx > 0, 'verifyOriginAdvanced call must exist');
  assert.ok(successReturnIdx > 0, 'success return after verify must exist');
  assert.ok(verifyIdx > pushIdx, 'verify must come after push');
  assert.ok(verifyIdx < successReturnIdx, 'verify must come before final success return');
});

// ---------------------------------------------------------------------------
// E — dispatch loop skips when .pipeline-paused exists
// ---------------------------------------------------------------------------

test('E — poll() checks for .pipeline-paused and skips dispatch', () => {
  const pollStart = orchestratorSource.indexOf('function poll()');
  assert.ok(pollStart > 0, 'poll function must exist');
  const pollBody = orchestratorSource.substring(pollStart);

  // pipeline-paused check must exist in poll
  const pauseCheck = pollBody.indexOf('PIPELINE_PAUSED_FILE');
  assert.ok(pauseCheck > 0, 'PIPELINE_PAUSED_FILE check must exist in poll()');

  // It must come before the main dispatch logic (reading queue dir)
  const queueRead = pollBody.indexOf('readdirSync(QUEUE_DIR)');
  assert.ok(queueRead > 0, 'queue directory read must exist');
  assert.ok(pauseCheck < queueRead, '.pipeline-paused check must come before queue read (dispatch logic)');
});

test('E2 — pipeline-paused check logs the reason from the flag file', () => {
  const pollStart = orchestratorSource.indexOf('function poll()');
  const pollBody = orchestratorSource.substring(pollStart);

  // Should read the file and extract reason
  assert.ok(pollBody.includes('Pipeline paused'), 'must log pipeline paused message');
  assert.ok(pollBody.includes('readFileSync(PIPELINE_PAUSED_FILE'), 'must read the flag file to extract reason');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
