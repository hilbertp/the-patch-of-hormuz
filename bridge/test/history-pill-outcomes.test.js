'use strict';

/**
 * history-pill-outcomes.test.js — Slice 280 (W-History-1)
 *
 * Unit tests for the four-state history pill outcome derivation:
 *   MERGED, ON_DEV, DEFERRED, ERROR (+ accepted-override).
 *
 * Run: node --test bridge/test/history-pill-outcomes.test.js
 *
 * Uses node:test (built-in). No new npm dependencies.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { deriveHistoryOutcome } = require('../../dashboard/server');

// Helper: build sets from arrays of string IDs
function makeSets({ merged = [], squashed = [], deferred = [], accepted = [] } = {}) {
  return {
    mergedIds:        new Set(merged),
    squashedToDevIds: new Set(squashed),
    deferredIds:      new Set(deferred),
    acceptedSet:      new Set(accepted),
  };
}

describe('deriveHistoryOutcome — four-state pill', () => {

  it('scenario 1: squashed to dev → ON_DEV', () => {
    const sets = makeSets({ squashed: ['100'] });
    assert.strictEqual(deriveHistoryOutcome('100', 'DONE', sets), 'ON_DEV');
  });

  it('scenario 2: merged via gate (SLICE_MERGED_TO_MAIN) → MERGED', () => {
    // Slice was squashed then merged — squashedToDevIds should NOT contain it
    // (caller removes merged IDs from squashed set), so mergedIds wins.
    const sets = makeSets({ merged: ['101'] });
    assert.strictEqual(deriveHistoryOutcome('101', 'DONE', sets), 'MERGED');
  });

  it('scenario 3: merged via legacy direct merge → MERGED', () => {
    const sets = makeSets({ merged: ['050'] });
    assert.strictEqual(deriveHistoryOutcome('050', 'DONE', sets), 'MERGED');
  });

  it('scenario 4: deferred (gate was running) → DEFERRED', () => {
    const sets = makeSets({ deferred: ['102'] });
    assert.strictEqual(deriveHistoryOutcome('102', 'DONE', sets), 'DEFERRED');
  });

  it('scenario 5: genuine error without acceptance → ERROR', () => {
    const sets = makeSets();
    assert.strictEqual(deriveHistoryOutcome('103', 'ERROR', sets), 'ERROR');
  });

  it('scenario 6: error with acceptance (Nog accepted but no squash yet) → ON_DEV', () => {
    const sets = makeSets({ accepted: ['277'] });
    assert.strictEqual(deriveHistoryOutcome('277', 'ERROR', sets), 'ON_DEV');
  });

  it('scenario 7: merged takes priority over squashed-to-dev', () => {
    // If both merged and squashed are present (shouldn't happen after cleanup,
    // but test priority), merged wins.
    const sets = makeSets({ merged: ['104'], squashed: ['104'] });
    assert.strictEqual(deriveHistoryOutcome('104', 'DONE', sets), 'MERGED');
  });

  it('scenario 8: plain DONE (in-progress, no terminal event) → DONE', () => {
    const sets = makeSets();
    assert.strictEqual(deriveHistoryOutcome('105', 'DONE', sets), 'DONE');
  });

});
