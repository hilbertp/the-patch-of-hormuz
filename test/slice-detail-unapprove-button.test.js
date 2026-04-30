'use strict';

/**
 * slice-detail-unapprove-button.test.js — Slice 272
 *
 * DOM render test: verifies the Un-approve button exists in the
 * slice-detail modal action footer for queued slices and is wired
 * to sliceDetailUnapprove().
 *
 * Run: node test/slice-detail-unapprove-button.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const HTML_PATH = path.join(__dirname, '..', 'dashboard', 'lcars-dashboard.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

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
  process.exit(failed > 0 ? 1 : 0);
}

console.log('\nslice-detail-unapprove-button.test.js (slice 272)\n');

test('Un-approve button exists in the queued-slice action footer', () => {
  // The else branch of renderSliceDetailActions renders queued-slice buttons
  // Find the container.innerHTML block that has "Remove from queue"
  const removeIdx = html.indexOf('onclick="sliceDetailRemove()"');
  assert.ok(removeIdx !== -1, 'sliceDetailRemove button should exist');

  // Un-approve button should appear BEFORE the Remove button in the same block
  const unapproveIdx = html.indexOf('onclick="sliceDetailUnapprove()"');
  assert.ok(unapproveIdx !== -1, 'sliceDetailUnapprove button should exist');
  assert.ok(unapproveIdx < removeIdx, 'Un-approve button should appear before Remove from queue');
});

test('Un-approve button has correct label', () => {
  const match = html.match(/<button[^>]*onclick="sliceDetailUnapprove\(\)"[^>]*>([^<]+)<\/button>/);
  assert.ok(match, 'Un-approve button should be a <button> element');
  assert.strictEqual(match[1].trim(), 'Un-approve', `expected label "Un-approve", got "${match[1].trim()}"`);
});

test('sliceDetailUnapprove function is defined', () => {
  const fnMatch = html.match(/async\s+function\s+sliceDetailUnapprove\s*\(\)/);
  assert.ok(fnMatch, 'sliceDetailUnapprove function should be defined');
});

test('sliceDetailUnapprove calls /api/slice/:id/unapprove', () => {
  // Extract the function body
  const fnStart = html.indexOf('async function sliceDetailUnapprove()');
  assert.ok(fnStart !== -1);
  const snippet = html.slice(fnStart, fnStart + 500);
  assert.ok(snippet.includes('/api/slice/${sliceDetailState.id}/unapprove'), 'should call unapprove API');
  assert.ok(snippet.includes("method: 'POST'"), 'should use POST method');
});

test('Un-approve button is NOT destructive-styled (distinct from Remove)', () => {
  const match = html.match(/<button[^>]*onclick="sliceDetailUnapprove\(\)"[^>]*>/);
  assert.ok(match, 'button should exist');
  assert.ok(!match[0].includes('slice-action-destructive'), 'Un-approve should not have destructive class');
});

runTests();
