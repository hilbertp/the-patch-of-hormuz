'use strict';

const assert = require('assert');
const { buildNogPrompt } = require('../bridge/nog-prompt');

const prompt = buildNogPrompt({
  id: '999',
  round: 1,
  sliceFileContents: 'slice contents',
  doneReportContents: 'done report',
  gitDiff: 'diff --git ...',
  slicePath: '/tmp/fake-slice.md',
});

// ── Canonical vocabulary present ────────────────────────────────────────────

assert.ok(prompt.includes('ACCEPTED'), 'prompt must contain ACCEPTED');
assert.ok(prompt.includes('REJECTED'), 'prompt must contain REJECTED');
assert.ok(prompt.includes('ESCALATE'), 'prompt must contain ESCALATE');
assert.ok(prompt.includes('OVERSIZED'), 'prompt must contain OVERSIZED');

// ── Legacy verdict literals absent ──────────────────────────────────────────

// Match only verdict-context phrasing: "verdict: PASS" / "verdict: RETURN"
// Avoid false positives on words like "passing", "return value", "RETURN_VALUE"
assert.ok(
  !/verdict:\s*PASS\b/i.test(prompt),
  'prompt must not contain "verdict: PASS"',
);
assert.ok(
  !/verdict:\s*RETURN\b/i.test(prompt),
  'prompt must not contain "verdict: RETURN"',
);

console.log('nog-prompt-vocabulary: all assertions passed');
