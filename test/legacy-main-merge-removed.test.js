'use strict';

/**
 * legacy-main-merge-removed.test.js — Slice 273
 *
 * Assert that acceptAndMerge's code path no longer contains git merge --no-ff
 * against main. Static check on the source file.
 *
 * Run: node test/legacy-main-merge-removed.test.js
 */

const fs = require('fs');
const path = require('path');
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

console.log('\nlegacy-main-merge-removed tests (slice 273)');

test('A — acceptAndMerge does not call mergeBranch', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'bridge', 'orchestrator.js'), 'utf-8');

  // Extract acceptAndMerge function body
  const fnStart = source.indexOf('function acceptAndMerge(');
  assert.ok(fnStart !== -1, 'acceptAndMerge function should exist');

  // Find the end of acceptAndMerge by tracking brace depth
  let depth = 0;
  let fnEnd = fnStart;
  let foundOpen = false;
  for (let i = fnStart; i < source.length; i++) {
    if (source[i] === '{') { depth++; foundOpen = true; }
    if (source[i] === '}') { depth--; }
    if (foundOpen && depth === 0) { fnEnd = i + 1; break; }
  }

  const fnBody = source.slice(fnStart, fnEnd);

  // Verify no call to mergeBranch
  assert.ok(!fnBody.includes('mergeBranch('), 'acceptAndMerge should not call mergeBranch');
  assert.ok(!fnBody.includes('mergeBranch ('), 'acceptAndMerge should not call mergeBranch');
});

test('B — acceptAndMerge does not contain git merge --no-ff targeting main', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'bridge', 'orchestrator.js'), 'utf-8');

  // Extract acceptAndMerge function body
  const fnStart = source.indexOf('function acceptAndMerge(');
  let depth = 0;
  let fnEnd = fnStart;
  let foundOpen = false;
  for (let i = fnStart; i < source.length; i++) {
    if (source[i] === '{') { depth++; foundOpen = true; }
    if (source[i] === '}') { depth--; }
    if (foundOpen && depth === 0) { fnEnd = i + 1; break; }
  }

  const fnBody = source.slice(fnStart, fnEnd);

  // No git merge --no-ff in acceptAndMerge
  assert.ok(!fnBody.includes('git merge --no-ff'), 'acceptAndMerge should not contain git merge --no-ff');
});

test('C — acceptAndMerge does not call unlock-main.sh or lock-main.sh', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'bridge', 'orchestrator.js'), 'utf-8');

  const fnStart = source.indexOf('function acceptAndMerge(');
  let depth = 0;
  let fnEnd = fnStart;
  let foundOpen = false;
  for (let i = fnStart; i < source.length; i++) {
    if (source[i] === '{') { depth++; foundOpen = true; }
    if (source[i] === '}') { depth--; }
    if (foundOpen && depth === 0) { fnEnd = i + 1; break; }
  }

  const fnBody = source.slice(fnStart, fnEnd);

  assert.ok(!fnBody.includes('unlock-main'), 'acceptAndMerge should not reference unlock-main');
  assert.ok(!fnBody.includes('lock-main'), 'acceptAndMerge should not reference lock-main');
});

test('D — acceptAndMerge calls shouldDeferSquash and squashSliceToDev', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'bridge', 'orchestrator.js'), 'utf-8');

  const fnStart = source.indexOf('function acceptAndMerge(');
  let depth = 0;
  let fnEnd = fnStart;
  let foundOpen = false;
  for (let i = fnStart; i < source.length; i++) {
    if (source[i] === '{') { depth++; foundOpen = true; }
    if (source[i] === '}') { depth--; }
    if (foundOpen && depth === 0) { fnEnd = i + 1; break; }
  }

  const fnBody = source.slice(fnStart, fnEnd);

  assert.ok(fnBody.includes('shouldDeferSquash()'), 'acceptAndMerge should call shouldDeferSquash()');
  assert.ok(fnBody.includes('squashSliceToDev('), 'acceptAndMerge should call squashSliceToDev');
});

test('E — No direct gate-running.json reads in acceptAndMerge', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'bridge', 'orchestrator.js'), 'utf-8');

  const fnStart = source.indexOf('function acceptAndMerge(');
  let depth = 0;
  let fnEnd = fnStart;
  let foundOpen = false;
  for (let i = fnStart; i < source.length; i++) {
    if (source[i] === '{') { depth++; foundOpen = true; }
    if (source[i] === '}') { depth--; }
    if (foundOpen && depth === 0) { fnEnd = i + 1; break; }
  }

  const fnBody = source.slice(fnStart, fnEnd);

  assert.ok(!fnBody.includes('gate-running.json'), 'acceptAndMerge should not directly read gate-running.json');
});

test('F — acceptAndMerge no longer routes through mergeBranch to reach main', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'bridge', 'orchestrator.js'), 'utf-8');

  // acceptAndMerge should use squashSliceToDev (→ dev), never mergeBranch (→ main)
  const fnStart = source.indexOf('function acceptAndMerge(');
  let depth = 0;
  let fnEnd = fnStart;
  let foundOpen = false;
  for (let i = fnStart; i < source.length; i++) {
    if (source[i] === '{') { depth++; foundOpen = true; }
    if (source[i] === '}') { depth--; }
    if (foundOpen && depth === 0) { fnEnd = i + 1; break; }
  }
  const fnBody = source.slice(fnStart, fnEnd);

  // No mergeBranch call — the legacy path is gone
  assert.ok(!fnBody.includes('mergeBranch'), 'acceptAndMerge should not reference mergeBranch at all');

  // squashSliceToDev is used instead
  assert.ok(fnBody.includes('squashSliceToDev'), 'acceptAndMerge should use squashSliceToDev');

  // Verify SLICE_DEFERRED register event is emitted for the defer path
  assert.ok(fnBody.includes('SLICE_DEFERRED'), 'acceptAndMerge should emit SLICE_DEFERRED for deferred slices');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
