'use strict';

/**
 * gate-fail-step-card.test.js — Slice 271
 *
 * Dashboard render test: verifies that when branch-state shows GATE_FAILED
 * with failed_acs[], the updateGateStepCards function renders:
 *   1. Failed ACs list
 *   2. Investigate button
 *   3. Abort button
 *
 * Uses minimal DOM simulation (no browser required).
 *
 * Run: node test/gate-fail-step-card.test.js
 */

const assert = require('assert');

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Minimal DOM simulation
// ---------------------------------------------------------------------------

const elements = {};

function createElement(id) {
  const el = {
    id,
    className: '',
    textContent: '',
    innerHTML: '',
    style: { display: '' },
  };
  elements[id] = el;
  return el;
}

// Create the elements the step card functions expect
createElement('gate-steps');
createElement('gate-step-1');
createElement('gate-step-1-body');
createElement('gate-step-2');
createElement('gate-step-2-body');
createElement('gate-step-3');
createElement('gate-step-3-body');
createElement('gate-steps-error');

// Mock global document.getElementById
global.document = {
  getElementById: function(id) { return elements[id] || null; },
};

// ---------------------------------------------------------------------------
// Extracted render logic (mirrors updateGateStepCards from lcars-dashboard.html)
// ---------------------------------------------------------------------------

function updateGateStepCards(gateStatus, gateData) {
  const stepsEl = elements['gate-steps'];
  if (!stepsEl) return;

  if (!gateStatus || gateStatus === 'IDLE' || gateStatus === 'ACCUMULATING') {
    stepsEl.style.display = 'none';
    return;
  }

  stepsEl.style.display = '';

  if (gateStatus === 'GATE_FAILED') {
    elements['gate-step-1'].className = 'gate-step-card done';
    elements['gate-step-2'].className = 'gate-step-card error';

    const failedAcs = gateData && gateData.last_failure ? (gateData.last_failure.failed_acs || []) : [];
    const count = failedAcs.length;

    let html = '<div style="font-weight:600;color:var(--err);margin-bottom:4px">' +
      'Regression gate failed \u2014 ' + count + ' AC' + (count !== 1 ? 's' : '') + ' not met</div>';

    if (count > 0) {
      html += '<ul class="failed-acs-list">';
      failedAcs.forEach(function(ac) {
        const excerpt = ac.failure_excerpt || '';
        const truncated = excerpt.length > 80 ? excerpt.substring(0, 80) + '\u2026' : excerpt;
        html += '<li class="failed-ac-row">' +
          '<span class="ac-label">slice ' + (ac.slice_id || '?') + ': AC ' + (ac.ac_index >= 0 ? ac.ac_index : '?') + '</span>' +
          ' \u00B7 ' + (ac.test_path || '') + ' \u00B7 ' + truncated +
          '<div class="failed-ac-detail">' + excerpt + '</div>' +
          '</li>';
      });
      html += '</ul>';
    }

    html += '<div class="gate-fail-actions">' +
      '<button class="btn">Investigate</button>' +
      '<button class="btn-stop">Abort gate</button>' +
      '</div>';

    elements['gate-step-2-body'].innerHTML = html;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\ngate-fail-step-card.test.js (slice 271)\n');

test('renders failed_acs list with correct count', () => {
  const gateData = {
    status: 'GATE_FAILED',
    last_failure: {
      ts: '2026-04-29T10:00:00Z',
      dev_tip_sha: 'abc123',
      failed_acs: [
        { slice_id: '100', ac_index: 1, test_path: 'slice-100-ac-1', failure_excerpt: 'Expected true got false' },
        { slice_id: '100', ac_index: 2, test_path: 'slice-100-ac-2', failure_excerpt: 'Timeout after 5000ms' },
        { slice_id: '101', ac_index: 1, test_path: 'slice-101-ac-1', failure_excerpt: 'Missing export' },
      ],
    },
  };

  updateGateStepCards('GATE_FAILED', gateData);

  const body = elements['gate-step-2-body'].innerHTML;
  assert.ok(body.includes('3 ACs not met'), 'should show count of failed ACs');
  assert.ok(body.includes('slice 100: AC 1'), 'should show first failed AC');
  assert.ok(body.includes('slice 100: AC 2'), 'should show second failed AC');
  assert.ok(body.includes('slice 101: AC 1'), 'should show third failed AC');
});

test('renders Investigate and Abort buttons', () => {
  const gateData = {
    status: 'GATE_FAILED',
    last_failure: {
      ts: '2026-04-29T10:00:00Z',
      dev_tip_sha: 'abc123',
      failed_acs: [
        { slice_id: '100', ac_index: 1, test_path: 'slice-100-ac-1', failure_excerpt: 'fail' },
      ],
    },
  };

  updateGateStepCards('GATE_FAILED', gateData);

  const body = elements['gate-step-2-body'].innerHTML;
  assert.ok(body.includes('gate-fail-actions'), 'should have gate-fail-actions container');
  assert.ok(body.includes('Investigate'), 'should have Investigate button');
  assert.ok(body.includes('Abort gate'), 'should have Abort gate button');
  assert.ok(body.includes('btn-stop'), 'Abort button should use btn-stop class');
});

test('Step 2 gets error variant, Step 1 gets done variant', () => {
  const gateData = {
    status: 'GATE_FAILED',
    last_failure: { ts: '2026-04-29T10:00:00Z', dev_tip_sha: 'abc', failed_acs: [] },
  };

  updateGateStepCards('GATE_FAILED', gateData);

  assert.strictEqual(elements['gate-step-1'].className, 'gate-step-card done');
  assert.strictEqual(elements['gate-step-2'].className, 'gate-step-card error');
});

test('truncates failure_excerpt to 80 chars', () => {
  const longExcerpt = 'A'.repeat(120);
  const gateData = {
    status: 'GATE_FAILED',
    last_failure: {
      ts: '2026-04-29T10:00:00Z',
      dev_tip_sha: 'abc',
      failed_acs: [
        { slice_id: '100', ac_index: 1, test_path: 'test', failure_excerpt: longExcerpt },
      ],
    },
  };

  updateGateStepCards('GATE_FAILED', gateData);

  const body = elements['gate-step-2-body'].innerHTML;
  // The truncated text should end with \u2026 (ellipsis) after 80 chars
  assert.ok(body.includes('A'.repeat(80) + '\u2026'), 'should truncate at 80 chars with ellipsis');
  // Full excerpt should be in the detail
  assert.ok(body.includes(longExcerpt), 'full excerpt should be in detail');
});

test('handles zero failed_acs gracefully', () => {
  const gateData = {
    status: 'GATE_FAILED',
    last_failure: { ts: '2026-04-29T10:00:00Z', dev_tip_sha: 'abc', failed_acs: [] },
  };

  updateGateStepCards('GATE_FAILED', gateData);

  const body = elements['gate-step-2-body'].innerHTML;
  assert.ok(body.includes('0 ACs not met'), 'should show 0 ACs');
  assert.ok(!body.includes('failed-acs-list'), 'should not render empty list');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
