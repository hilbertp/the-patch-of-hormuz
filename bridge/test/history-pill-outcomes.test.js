'use strict';

/**
 * history-pill-outcomes.test.js — Slice 280 (W-History-1), updated by slice 281 (W-History-2)
 *
 * Unit tests for the three-state history pill outcome derivation:
 *   ON_DEV, DEFERRED, ERROR (+ accepted-override + historical MERGED fallback).
 *
 * Run: node --test bridge/test/history-pill-outcomes.test.js
 *
 * Uses node:test (built-in). No new npm dependencies.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { deriveHistoryOutcome } = require('../../dashboard/server');

// Helper: build sets from arrays of string IDs
function makeSets({ squashed = [], deferred = [], accepted = [] } = {}) {
  return {
    squashedToDevIds: new Set(squashed),
    deferredIds:      new Set(deferred),
    acceptedSet:      new Set(accepted),
  };
}

describe('deriveHistoryOutcome — three-state pill', () => {

  it('scenario 1: squashed to dev → ON_DEV', () => {
    const sets = makeSets({ squashed: ['100'] });
    assert.strictEqual(deriveHistoryOutcome('100', 'DONE', sets), 'ON_DEV');
  });

  it('scenario 2: historical pre-gate slice with MERGED event (no SLICE_SQUASHED_TO_DEV) → ON_DEV', () => {
    // Pre-gate slices have rawOutcome === 'MERGED' but no squashed event.
    // The fallback maps MERGED → ON_DEV for pill display.
    const sets = makeSets();
    assert.strictEqual(deriveHistoryOutcome('050', 'MERGED', sets), 'ON_DEV');
  });

  it('scenario 3: deferred (gate was running) → DEFERRED', () => {
    const sets = makeSets({ deferred: ['102'] });
    assert.strictEqual(deriveHistoryOutcome('102', 'DONE', sets), 'DEFERRED');
  });

  it('scenario 4: genuine error without acceptance → ERROR', () => {
    const sets = makeSets();
    assert.strictEqual(deriveHistoryOutcome('103', 'ERROR', sets), 'ERROR');
  });

  it('scenario 5: error with acceptance (Nog accepted but no squash yet) → ON_DEV', () => {
    const sets = makeSets({ accepted: ['277'] });
    assert.strictEqual(deriveHistoryOutcome('277', 'ERROR', sets), 'ON_DEV');
  });

  it('scenario 6: plain DONE (in-progress, no terminal event) → DONE', () => {
    const sets = makeSets();
    assert.strictEqual(deriveHistoryOutcome('105', 'DONE', sets), 'DONE');
  });

});
