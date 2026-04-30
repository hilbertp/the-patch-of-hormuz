'use strict';

/**
 * rr-pill-render.test.js — Slice 270
 *
 * Dashboard render test: verifies the RR pill DOM matches the expected
 * band class for synthetic branch-state data.
 *
 * Mirrors the renderRRPill() logic from lcars-dashboard.html.
 *
 * Run: node test/rr-pill-render.test.js
 */

const assert = require('assert');

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

// Mirror of renderRRPill from lcars-dashboard.html
function renderRRPill(bs) {
  const rr = bs.regression_risk;
  const ahead = bs.dev ? (bs.dev.commits_ahead_of_main || 0) : 0;

  if (!rr || ahead === 0) {
    return '<span class="rr-pill green">RR 0% &middot; clean</span>';
  }

  const band = rr.band || 'green';
  const pct = rr.rr != null ? rr.rr : 0;
  const inputs = rr.inputs || {};
  const sp = Math.round((inputs.slice_pressure || 0) * 100);
  const sv = Math.round((inputs.surface_volatility || 0) * 100);
  const ac = Math.round((inputs.ac_coverage_gap || 0) * 100);

  const label = pct === 0 ? 'RR 0% &middot; clean' : `RR ${pct}%`;

  return `<span class="rr-pill ${band}">${label}<span class="rr-pill-tooltip">Slice pressure: ${sp}% | Surface volatility: ${sv}% | AC coverage gap: ${ac}%</span></span>`;
}

console.log('\n-- rr-pill-render tests --');

// ---------------------------------------------------------------------------
// 1. Empty dev → green pill with "RR 0% · clean"
// ---------------------------------------------------------------------------
test('empty dev → green pill with clean label', () => {
  const html = renderRRPill({
    dev: { commits_ahead_of_main: 0, commits: [] },
  });
  assert.ok(html.includes('rr-pill green'), `Expected green class, got: ${html}`);
  assert.ok(html.includes('RR 0%'), `Expected RR 0%, got: ${html}`);
  assert.ok(html.includes('clean'), `Expected clean label, got: ${html}`);
});

// ---------------------------------------------------------------------------
// 2. Amber band → amber class with tooltip
// ---------------------------------------------------------------------------
test('amber band renders correctly with tooltip', () => {
  const html = renderRRPill({
    dev: { commits_ahead_of_main: 5, commits: [{}, {}, {}, {}, {}] },
    regression_risk: {
      rr: 42,
      band: 'amber',
      inputs: { slice_pressure: 0.5, surface_volatility: 0.3, ac_coverage_gap: 0.2 },
    },
  });
  assert.ok(html.includes('rr-pill amber'), `Expected amber class, got: ${html}`);
  assert.ok(html.includes('RR 42%'), `Expected RR 42%, got: ${html}`);
  assert.ok(html.includes('rr-pill-tooltip'), `Expected tooltip, got: ${html}`);
  assert.ok(html.includes('Slice pressure: 50%'), `Expected slice pressure 50%, got: ${html}`);
  assert.ok(html.includes('Surface volatility: 30%'), `Expected surface volatility 30%, got: ${html}`);
  assert.ok(html.includes('AC coverage gap: 20%'), `Expected AC coverage gap 20%, got: ${html}`);
});

// ---------------------------------------------------------------------------
// 3. Red band → red class
// ---------------------------------------------------------------------------
test('red band renders with red class', () => {
  const html = renderRRPill({
    dev: { commits_ahead_of_main: 10, commits: new Array(10).fill({}) },
    regression_risk: {
      rr: 85,
      band: 'red',
      inputs: { slice_pressure: 1.0, surface_volatility: 0.7, ac_coverage_gap: 0.9 },
    },
  });
  assert.ok(html.includes('rr-pill red'), `Expected red class, got: ${html}`);
  assert.ok(html.includes('RR 85%'), `Expected RR 85%, got: ${html}`);
});

// ---------------------------------------------------------------------------
// 4. Green band with non-zero RR
// ---------------------------------------------------------------------------
test('green band with rr=15 renders percentage', () => {
  const html = renderRRPill({
    dev: { commits_ahead_of_main: 2, commits: [{}, {}] },
    regression_risk: {
      rr: 15,
      band: 'green',
      inputs: { slice_pressure: 0.2, surface_volatility: 0.1, ac_coverage_gap: 0.05 },
    },
  });
  assert.ok(html.includes('rr-pill green'), `Expected green class, got: ${html}`);
  assert.ok(html.includes('RR 15%'), `Expected RR 15%, got: ${html}`);
});

// ---------------------------------------------------------------------------
// 5. No regression_risk in branch-state → clean green
// ---------------------------------------------------------------------------
test('no regression_risk field → clean green pill', () => {
  const html = renderRRPill({
    dev: { commits_ahead_of_main: 3, commits: [{}, {}, {}] },
  });
  assert.ok(html.includes('rr-pill green'), `Expected green class, got: ${html}`);
  assert.ok(html.includes('clean'), `Expected clean, got: ${html}`);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
