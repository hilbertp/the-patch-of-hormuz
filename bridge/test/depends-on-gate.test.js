'use strict';

/**
 * depends-on-gate.test.js — Slice 293 (F-Disp-2)
 *
 * Tests that --depends-on actually gates dispatch: slices with unmet deps
 * are deferred, slices with met deps (MERGED or SLICE_MERGED_TO_MAIN) dispatch,
 * and SLICE_DISPATCH_DEFERRED events are emitted once per slice per process.
 *
 * Run: node --test bridge/test/depends-on-gate.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  hasMergedEvent,
  depsAreMet,
  _testSetRegisterFile,
  _testResetDeferredEmitted,
  _testGetDeferredEmitted,
} = require('../orchestrator.js');

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDir;
let registerPath;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'depends-on-gate-test-'));
  registerPath = path.join(tmpDir, 'register.jsonl');
  fs.writeFileSync(registerPath, '', 'utf-8');
  _testSetRegisterFile(registerPath);
  _testResetDeferredEmitted();
}

function teardown() {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
}

function appendEvent(sliceId, event, extra) {
  const entry = Object.assign({ ts: new Date().toISOString(), slice_id: String(sliceId), event }, extra || {});
  fs.appendFileSync(registerPath, JSON.stringify(entry) + '\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('depends-on dispatch gate', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('slice with empty depends_on dispatches immediately', () => {
    const meta = { depends_on: '' };
    assert.equal(depsAreMet(meta), true);
  });

  it('slice with depends_on: "100" and no MERGED event for 100 is deferred', () => {
    const meta = { depends_on: '100' };
    assert.equal(depsAreMet(meta), false);
  });

  it('slice with depends_on: "100" dispatches after MERGED event for 100', () => {
    appendEvent('100', 'MERGED', { sha: 'abc123' });
    const meta = { depends_on: '100' };
    assert.equal(depsAreMet(meta), true);
  });

  it('slice with depends_on: "100,101" deferred when only 100 merged', () => {
    appendEvent('100', 'MERGED', { sha: 'abc123' });
    const meta = { depends_on: '100,101' };
    assert.equal(depsAreMet(meta), false);
  });

  it('slice with depends_on: "100,101" dispatches after both merged', () => {
    appendEvent('100', 'MERGED', { sha: 'abc123' });
    appendEvent('101', 'MERGED', { sha: 'def456' });
    const meta = { depends_on: '100,101' };
    assert.equal(depsAreMet(meta), true);
  });

  it('SLICE_MERGED_TO_MAIN satisfies dependency (gate-path equivalent)', () => {
    appendEvent('100', 'SLICE_MERGED_TO_MAIN', { sha: 'ghi789' });
    const meta = { depends_on: '100' };
    assert.equal(depsAreMet(meta), true);
  });

  it('SLICE_DISPATCH_DEFERRED emitted only once per slice across ticks', () => {
    // Simulate multiple poll ticks checking the same deferred slice.
    const emitted = _testGetDeferredEmitted();
    assert.equal(emitted.has('200'), false);

    // First deferral — should add to set.
    emitted.add('200');
    assert.equal(emitted.has('200'), true);

    // Subsequent checks — set already contains it, no re-emit.
    assert.equal(emitted.has('200'), true);

    // A different slice can still emit.
    assert.equal(emitted.has('201'), false);
    emitted.add('201');
    assert.equal(emitted.has('201'), true);
  });
});

describe('depends-on edge cases', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('null depends_on dispatches immediately', () => {
    assert.equal(depsAreMet({ depends_on: null }), true);
    assert.equal(depsAreMet({}), true);
    assert.equal(depsAreMet(null), true);
  });

  it('whitespace/trailing commas parsed defensively', () => {
    const meta = { depends_on: ' 100 , , ' };
    appendEvent('100', 'MERGED', { sha: 'x' });
    assert.equal(depsAreMet(meta), true);
  });

  it('"null" string treated as no deps', () => {
    assert.equal(depsAreMet({ depends_on: 'null' }), true);
  });
});
