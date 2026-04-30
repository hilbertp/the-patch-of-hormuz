'use strict';

/**
 * rr-compute.js — Regression Risk (RR) computation (slice 270).
 *
 * Single export: computeRR(opts).
 * Reads branch-state.json, register.jsonl, slice files, and regression/ tests
 * to produce an RR percentage with band coloring.
 *
 * Weights from project_bashir_design_2026-04-28.md — may be tuned after
 * empirical data from several real gate cycles.
 *
 * Placement: bridge/rr-compute.js (peer to bridge/state/, NOT inside it —
 * bridge/state/ is Worf-owned).
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Defaults — overridable for testing
// ---------------------------------------------------------------------------

let BRANCH_STATE_PATH = path.resolve(__dirname, 'state', 'branch-state.json');
let REGISTER_PATH = path.resolve(__dirname, 'register.jsonl');
let QUEUE_DIR = path.resolve(__dirname, 'queue');
let REGRESSION_DIR = path.resolve(__dirname, '..', 'regression');

// Weights (from project_bashir_design_2026-04-28.md — tune after empirical data)
const W_SLICE_PRESSURE = 0.30;
const W_SURFACE_VOLATILITY = 0.50;
const W_AC_COVERAGE_GAP = 0.20;

// ---------------------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------------------

function _testSetPaths(opts) {
  if (opts.branchStatePath) BRANCH_STATE_PATH = opts.branchStatePath;
  if (opts.registerPath) REGISTER_PATH = opts.registerPath;
  if (opts.queueDir) QUEUE_DIR = opts.queueDir;
  if (opts.regressionDir) REGRESSION_DIR = opts.regressionDir;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read register.jsonl and return NOG_TELEMETRY events for the given slice IDs.
 */
function readNogTelemetryEvents(sliceIds) {
  const idSet = new Set(sliceIds.map(String));
  const events = [];
  try {
    const lines = fs.readFileSync(REGISTER_PATH, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.event === 'NOG_TELEMETRY' && idSet.has(String(entry.slice_id))) {
          events.push(entry);
        }
      } catch (_) { /* skip malformed lines */ }
    }
  } catch (_) { /* register unreadable — return empty */ }
  return events;
}

/**
 * Count ACs in a slice file by looking for numbered items in "## Acceptance criteria".
 */
function countSliceAcs(sliceFilePath) {
  try {
    const content = fs.readFileSync(sliceFilePath, 'utf-8');
    const acMatch = content.match(/## Acceptance [Cc]riteria[\s\S]*?(?=\n## |\n---|\s*$)/);
    if (!acMatch) return 0;
    const numbered = acMatch[0].match(/^\s*\d+\.\s/gm);
    return numbered ? numbered.length : 0;
  } catch (_) { return 0; }
}

/**
 * Count regression tests matching `slice-<id>-ac-<index>` naming convention.
 */
function countCoveredAcs(sliceId) {
  const covered = new Set();
  try {
    const files = fs.readdirSync(REGRESSION_DIR);
    const prefix = `slice-${sliceId}-ac-`;
    for (const f of files) {
      if (f.startsWith(prefix)) {
        // Extract AC index: slice-42-ac-1.test.js → 1
        const rest = f.slice(prefix.length);
        const idx = parseInt(rest, 10);
        if (!isNaN(idx)) covered.add(idx);
      }
    }
  } catch (_) { /* regression dir missing — 0 coverage */ }
  return covered.size;
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

function computeRR() {
  // 1. Read branch-state.json
  let branchState;
  try {
    branchState = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
  } catch (_) {
    // Unreadable — return zero-risk
    return { rr: 0, band: 'green', inputs: { slice_pressure: 0, surface_volatility: 0, ac_coverage_gap: 0 } };
  }

  const commits = (branchState.dev && branchState.dev.commits) || [];

  // Empty dev — clean state
  if (commits.length === 0) {
    return { rr: 0, band: 'green', inputs: { slice_pressure: 0, surface_volatility: 0, ac_coverage_gap: 0 } };
  }

  // 2. slice_pressure = min(1.0, commits.length / 10)
  const slice_pressure = Math.min(1.0, commits.length / 10);

  // 3. surface_volatility — weighted score from NOG_TELEMETRY events
  const sliceIds = commits.map(c => String(c.slice_id));
  const telemetryEvents = readNogTelemetryEvents(sliceIds);

  let volatilitySum = 0;
  for (const evt of telemetryEvents) {
    let score = 0;
    if (evt.high_risk_surface) score += 1.0;
    if ((evt.lint_findings_total || 0) >= 3) score += 0.3;
    if ((evt.rounds || 0) >= 3) score += 0.2;
    if (evt.escalated) score += 0.5;
    volatilitySum += score;
  }
  // Normalize: max possible per slice is 2.0 (1.0+0.3+0.2+0.5), so normalize by sliceCount * 2.0
  const maxVolatility = sliceIds.length * 2.0;
  const surface_volatility = maxVolatility > 0 ? Math.min(1.0, volatilitySum / maxVolatility) : 0;

  // 4. ac_coverage_gap
  let totalAcs = 0;
  let coveredAcs = 0;
  for (const sliceId of sliceIds) {
    // Try to find the slice file in queue (PARKED, ACCEPTED, ARCHIVED, or DONE)
    const suffixes = ['-PARKED.md', '-ACCEPTED.md', '-ARCHIVED.md', '-DONE.md', '-PENDING.md'];
    let acCount = 0;
    for (const suffix of suffixes) {
      const p = path.join(QUEUE_DIR, sliceId + suffix);
      acCount = countSliceAcs(p);
      if (acCount > 0) break;
    }
    totalAcs += acCount;
    coveredAcs += countCoveredAcs(sliceId);
  }
  const ac_coverage_gap = totalAcs > 0 ? Math.max(0, 1 - (coveredAcs / totalAcs)) : 0;

  // 5. RR formula
  const rawRR = 100 * (W_SLICE_PRESSURE * slice_pressure + W_SURFACE_VOLATILITY * surface_volatility + W_AC_COVERAGE_GAP * ac_coverage_gap);
  const rr = Math.round(Math.max(0, Math.min(100, rawRR)));

  // 6. Bands: 0-25 green, 26-60 amber, 61+ red
  let band;
  if (rr <= 25) band = 'green';
  else if (rr <= 60) band = 'amber';
  else band = 'red';

  // 7. Return result
  return {
    rr,
    band,
    inputs: {
      slice_pressure: Math.round(slice_pressure * 1000) / 1000,
      surface_volatility: Math.round(surface_volatility * 1000) / 1000,
      ac_coverage_gap: Math.round(ac_coverage_gap * 1000) / 1000,
    },
  };
}

module.exports = { computeRR, _testSetPaths };
