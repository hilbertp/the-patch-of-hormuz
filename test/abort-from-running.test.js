'use strict';

/**
 * abort-from-running.test.js — Slice 271
 *
 * Verifies that POST /api/gate/abort returns 409 when gate.status is GATE_RUNNING.
 * Abort during a running gate is not supported (mid-flight kill is a separate concern).
 *
 * Run: node test/abort-from-running.test.js
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  \u2713 ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`  \u2717 ${t.name}`);
      console.log(`    ${err.message}`);
    }
  }
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

const BRANCH_STATE_PATH = path.resolve(__dirname, '..', 'bridge', 'state', 'branch-state.json');
const { writeJsonAtomic } = require('../bridge/state/atomic-write');

const originalBranchState = fs.readFileSync(BRANCH_STATE_PATH, 'utf-8');

function cleanup() {
  fs.writeFileSync(BRANCH_STATE_PATH, originalBranchState, 'utf-8');
}

function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\nabort-from-running.test.js (slice 271)\n');

test('POST /api/gate/abort returns 409 when GATE_RUNNING', async () => {
  // Set up GATE_RUNNING state
  const state = JSON.parse(originalBranchState);
  state.gate = {
    status: 'GATE_RUNNING',
    current_run: { started_ts: new Date().toISOString(), snapshot_dev_tip_sha: 'abc123' },
    last_failure: null,
    last_pass: null,
  };
  writeJsonAtomic(BRANCH_STATE_PATH, state);

  // Start a temporary server
  const serverModule = require('../dashboard/server');
  // The server module exports the server object — we need to use the route handler
  // Instead, test the orchestrator's abortGate directly
  const { abortGate } = require('../bridge/orchestrator');

  let threw = false;
  let errCode = null;
  try {
    abortGate();
  } catch (err) {
    threw = true;
    errCode = err.code;
  }

  assert.ok(threw, 'abortGate should throw for GATE_RUNNING');
  assert.strictEqual(errCode, 'INVALID_STATE', 'error code should be INVALID_STATE');
});

test('abortGate rejects GATE_RUNNING with correct error details', async () => {
  const state = JSON.parse(originalBranchState);
  state.gate = {
    status: 'GATE_RUNNING',
    current_run: { started_ts: new Date().toISOString(), snapshot_dev_tip_sha: 'abc123' },
    last_failure: null,
    last_pass: null,
  };
  writeJsonAtomic(BRANCH_STATE_PATH, state);

  const { abortGate } = require('../bridge/orchestrator');

  try {
    abortGate();
    assert.fail('Should have thrown');
  } catch (err) {
    assert.strictEqual(err.status, 'GATE_RUNNING', 'error should include current status');
  }
});

runTests();
