'use strict';

/**
 * new-slice-bashir-target.test.js — Slice 299
 *
 * Tests that new-slice.js accepts --to bashir and writes correct frontmatter.
 *
 * Run: node test/new-slice-bashir-target.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Temp directories — fully isolated from real bridge dirs
// ---------------------------------------------------------------------------

const TEMP   = fs.mkdtempSync(path.join(os.tmpdir(), 'ds9-bashir-target-test-'));
const QUEUE  = path.join(TEMP, 'queue');
const STAGED = path.join(TEMP, 'staged');
const TRASH  = path.join(TEMP, 'trash');
const REG    = path.join(TEMP, 'register.jsonl');

for (const d of [QUEUE, STAGED, TRASH]) fs.mkdirSync(d, { recursive: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NEW_SLICE = path.join(__dirname, '..', 'bridge', 'new-slice.js');
const PROJECT   = path.join(__dirname, '..');

function baseEnv() {
  return Object.assign({}, process.env, {
    DS9_REGISTER_FILE: REG,
    DS9_QUEUE_DIR: QUEUE,
    DS9_STAGED_DIR: STAGED,
    DS9_TRASH_DIR: TRASH,
  });
}

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
// Tests
// ---------------------------------------------------------------------------

console.log('\nnew-slice-bashir-target.test.js');
console.log('\u2500'.repeat(50));

test('--to bashir creates a STAGED file with to: bashir frontmatter', () => {
  const out = execSync(
    `node "${NEW_SLICE}" --title "Bashir scouting" --goal "Scout tests" --to bashir --priority high`,
    { cwd: PROJECT, env: baseEnv(), encoding: 'utf-8' }
  );

  // Find the staged file
  const files = fs.readdirSync(STAGED);
  const stagedFile = files.find(f => f.endsWith('-STAGED.md'));
  assert.ok(stagedFile, 'Should have created a STAGED file');

  const content = fs.readFileSync(path.join(STAGED, stagedFile), 'utf-8');
  assert.ok(content.includes('to: bashir'), 'Frontmatter should have to: bashir');
  assert.ok(content.includes('priority: high'), 'Frontmatter should have priority: high');
  assert.ok(content.includes('from: obrien'), 'Frontmatter should have from: obrien');
});

test('--to bashir rejects invalid targets', () => {
  let threw = false;
  try {
    execSync(
      `node "${NEW_SLICE}" --title "Bad target" --goal "Should fail" --to worf --priority normal`,
      { cwd: PROJECT, env: baseEnv(), encoding: 'utf-8', stdio: 'pipe' }
    );
  } catch (err) {
    threw = true;
    assert.ok(err.stderr.toString().includes('--to must be one of'), 'Error should mention valid targets');
  }
  assert.ok(threw, 'Should have thrown for invalid --to target');
});

test('--to bashir with --body-file includes body in staged file', () => {
  const bodyFile = path.join(TEMP, 'test-body.md');
  fs.writeFileSync(bodyFile, '## Tasks\n\n- Scout test infrastructure\n- Report findings\n', 'utf-8');

  execSync(
    `node "${NEW_SLICE}" --title "Bashir body test" --goal "Test body inclusion" --to bashir --priority normal --body-file "${bodyFile}"`,
    { cwd: PROJECT, env: baseEnv(), encoding: 'utf-8' }
  );

  const files = fs.readdirSync(STAGED);
  // Get the latest staged file (highest ID)
  const stagedFiles = files.filter(f => f.endsWith('-STAGED.md')).sort();
  const latest = stagedFiles[stagedFiles.length - 1];
  const content = fs.readFileSync(path.join(STAGED, latest), 'utf-8');

  assert.ok(content.includes('to: bashir'), 'Should have to: bashir');
  assert.ok(content.includes('Scout test infrastructure'), 'Should include body content');
});

test('--to bashir with --timeout sets timeout_min', () => {
  execSync(
    `node "${NEW_SLICE}" --title "Bashir timeout test" --goal "Test timeout" --to bashir --priority normal --timeout 45`,
    { cwd: PROJECT, env: baseEnv(), encoding: 'utf-8' }
  );

  const files = fs.readdirSync(STAGED).filter(f => f.endsWith('-STAGED.md')).sort();
  const latest = files[files.length - 1];
  const content = fs.readFileSync(path.join(STAGED, latest), 'utf-8');

  assert.ok(content.includes('timeout_min: 45'), 'Should have timeout_min: 45');
});

test('--to bashir with --depends-on sets depends_on', () => {
  execSync(
    `node "${NEW_SLICE}" --title "Bashir deps test" --goal "Test deps" --to bashir --priority normal --depends-on "095,096"`,
    { cwd: PROJECT, env: baseEnv(), encoding: 'utf-8' }
  );

  const files = fs.readdirSync(STAGED).filter(f => f.endsWith('-STAGED.md')).sort();
  const latest = files[files.length - 1];
  const content = fs.readFileSync(path.join(STAGED, latest), 'utf-8');

  assert.ok(content.includes('depends_on: "095,096"'), 'Should have depends_on field');
});

// ---------------------------------------------------------------------------
// Cleanup + report
// ---------------------------------------------------------------------------

try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch (_) {}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
