'use strict';

/**
 * new-slice-restage.test.js
 *
 * Tests for slice 200 — --restage <id> flag in bridge/new-slice.js.
 *
 * Cases:
 *   AC1:  --restage writes staged file with original id (not max+1)
 *   AC2:  terminal queue files are moved to trash with .attempt1 suffix
 *   AC3:  git branch slice/<id> renamed to slice/<id>-attempt<N>
 *   AC4:  body-file frontmatter has rounds: preserved (slice 215)
 *   AC5:  RESTAGED event emitted when prior COMMISSIONED exists
 *   AC6:  rejects id with no prior history (exit 1)
 *   AC7:  rejects id that is currently active (exit 1)
 *   AC8:  without --restage: existing flow unchanged (max+1 ID)
 *   AC9a: second re-stage produces .attempt2 artifacts
 *   AC9b: second re-stage renames branch to attempt2
 *
 * Run: node test/new-slice-restage.test.js
 */

const fs           = require('fs');
const os           = require('os');
const path         = require('path');
const assert       = require('assert');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Temp directories — fully isolated from real bridge dirs
// ---------------------------------------------------------------------------

const TEMP    = fs.mkdtempSync(path.join(os.tmpdir(), 'ds9-restage-test-'));
const QUEUE   = path.join(TEMP, 'queue');
const STAGED  = path.join(TEMP, 'staged');
const TRASH   = path.join(TEMP, 'trash');
const REG     = path.join(TEMP, 'register.jsonl');

for (const d of [QUEUE, STAGED, TRASH]) fs.mkdirSync(d, { recursive: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NEW_SLICE = path.join(__dirname, '..', 'bridge', 'new-slice.js');
const PROJECT   = path.join(__dirname, '..');

function baseEnv() {
  return Object.assign({}, process.env, {
    DS9_REGISTER_FILE: REG,
    DS9_QUEUE_DIR:     QUEUE,
    DS9_STAGED_DIR:    STAGED,
    DS9_TRASH_DIR:     TRASH,
  });
}

function runNewSlice(extraArgs, extraEnv) {
  const env = Object.assign(baseEnv(), extraEnv || {});
  return execSync(
    `node ${NEW_SLICE} --title "Test slice" --goal "Test goal" --priority normal ${extraArgs || ''}`,
    { cwd: PROJECT, env, stdio: 'pipe' }
  ).toString();
}

function runNewSliceExpectFail(extraArgs, extraEnv) {
  const env = Object.assign(baseEnv(), extraEnv || {});
  try {
    execSync(
      `node ${NEW_SLICE} --title "Test slice" --goal "Test goal" --priority normal ${extraArgs || ''}`,
      { cwd: PROJECT, env, stdio: 'pipe' }
    );
    return { code: 0, stderr: '' };
  } catch (err) {
    return {
      code: err.status,
      stderr: (err.stderr || Buffer.from('')).toString(),
    };
  }
}

function writeReg(entries) {
  const body = entries.length
    ? entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    : '';
  fs.writeFileSync(REG, body, 'utf8');
}

function readReg() {
  try {
    return fs.readFileSync(REG, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) { return []; }
}

function writeQueueFile(id, state) {
  fs.writeFileSync(path.join(QUEUE, `${id}-${state}.md`), `# ${id}-${state}\n`, 'utf8');
}

function writeTrashFile(id, name, attempt) {
  fs.writeFileSync(path.join(TRASH, `${id}-${name}.md.attempt${attempt}`), `# trash\n`, 'utf8');
}

function stagedFileExists(id) {
  return fs.existsSync(path.join(STAGED, `${id}-STAGED.md`));
}

function readStaged(id) {
  return fs.readFileSync(path.join(STAGED, `${id}-STAGED.md`), 'utf8');
}

function queueFileExists(id, state) {
  return fs.existsSync(path.join(QUEUE, `${id}-${state}.md`));
}

function trashFileExists(id, state, attempt) {
  return fs.existsSync(path.join(TRASH, `${id}-${state}.md.attempt${attempt}`));
}

/** Create a fixture body-file with frontmatter including rounds: and round: */
function writeBodyFixture(extraFrontmatter) {
  const fp = path.join(TEMP, 'body-fixture.md');
  fs.writeFileSync(fp, [
    '---',
    'rounds: 3',
    'round: 2',
    ...(extraFrontmatter || []),
    '---',
    '',
    '## Body content',
    'Some details here.',
  ].join('\n'), 'utf8');
  return fp;
}

/** Clear out queue, staged, trash, register between tests */
function resetDirs() {
  for (const d of [QUEUE, STAGED, TRASH]) {
    try {
      for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f));
    } catch (_) {}
  }
  fs.writeFileSync(REG, '', 'utf8');
}

// ---------------------------------------------------------------------------
// Git branch helpers — operate in the real git repo but clean up after
// ---------------------------------------------------------------------------

function branchExists(name) {
  try {
    execSync(`git show-ref --verify --quiet refs/heads/${name}`, { cwd: PROJECT, stdio: 'pipe' });
    return true;
  } catch (_) {
    return false;
  }
}

function createBranch(name) {
  // Create from HEAD without checking it out
  execSync(`git branch ${name}`, { cwd: PROJECT, stdio: 'pipe' });
}

function deleteBranch(name) {
  try {
    execSync(`git branch -D ${name}`, { cwd: PROJECT, stdio: 'pipe' });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const branchesCreated = [];

function test(name, fn) {
  resetDirs();
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
  resetDirs();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\nnew-slice.js --restage flag');

// AC1: staged file uses the provided id, not max+1
test('AC1: --restage writes staged file with original id', () => {
  writeReg([
    { ts: '2026-04-01T00:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
  ]);
  writeQueueFile('999', 'DONE');

  runNewSlice('--restage 999');

  assert.ok(stagedFileExists('999'), 'bridge/staged/999-STAGED.md should exist');
  const content = readStaged('999');
  assert.match(content, /^id: "999"/m, 'id field should be "999"');
});

// AC2: terminal queue files moved to trash with .attempt1
test('AC2: terminal queue files archived to trash/.attempt1', () => {
  writeReg([
    { ts: '2026-04-01T00:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
  ]);
  writeQueueFile('999', 'DONE');
  writeQueueFile('999', 'PARKED');

  runNewSlice('--restage 999');

  assert.ok(!queueFileExists('999', 'DONE'),   '999-DONE.md should be gone from queue');
  assert.ok(!queueFileExists('999', 'PARKED'), '999-PARKED.md should be gone from queue');
  assert.ok(trashFileExists('999', 'DONE', 1),   'bridge/trash/999-DONE.md.attempt1 should exist');
  assert.ok(trashFileExists('999', 'PARKED', 1), 'bridge/trash/999-PARKED.md.attempt1 should exist');
});

// AC3: git branch slice/<id> renamed to slice/<id>-attempt1
test('AC3: git branch slice/999 renamed to slice/999-attempt1', () => {
  writeReg([
    { ts: '2026-04-01T00:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
  ]);
  writeQueueFile('999', 'DONE');

  // Create a real git branch for this test
  createBranch('slice/999');
  branchesCreated.push('slice/999', 'slice/999-attempt1');

  runNewSlice('--restage 999');

  assert.ok(!branchExists('slice/999'),          'slice/999 should no longer exist');
  assert.ok(branchExists('slice/999-attempt1'),  'slice/999-attempt1 should now exist');
});

// AC3b: missing git branch is skipped silently (no crash)
test('AC3b: missing git branch skipped silently', () => {
  writeReg([
    { ts: '2026-04-01T00:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
  ]);
  writeQueueFile('999', 'DONE');
  // Ensure branch does NOT exist
  deleteBranch('slice/999');

  // Should not throw
  runNewSlice('--restage 999');
  assert.ok(stagedFileExists('999'), 'staged file still created despite missing branch');
});

// AC4: rounds: preserved in body-file frontmatter (slice 215 — feedback_reuse_slice_id.md)
test('AC4: rounds: preserved in body-file frontmatter', () => {
  writeReg([
    { ts: '2026-04-01T00:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
  ]);
  writeQueueFile('999', 'DONE');

  const bodyFile = writeBodyFixture();
  runNewSlice(`--restage 999 --body-file ${bodyFile}`);

  const content = readStaged('999');
  assert.ok(content.includes('rounds:'), 'staged file must preserve rounds:');
  assert.ok(content.includes('Body content'), 'staged file should retain body content');
});

// AC5: RESTAGED event emitted when prior COMMISSIONED exists
test('AC5: RESTAGED event emitted when prior COMMISSIONED exists', () => {
  writeReg([
    { ts: '2026-04-01T00:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
  ]);
  writeQueueFile('999', 'DONE');

  runNewSlice('--restage 999');

  const restaged = readReg().filter(l => l.event === 'RESTAGED' && l.slice_id === '999');
  assert.strictEqual(restaged.length, 1, 'exactly one RESTAGED event for id 999');
});

// AC6: rejects id with no prior history
test('AC6: rejects --restage with no prior history (exit 1)', () => {
  // No register entries, no queue files, no trash files for id 555
  writeReg([]);
  const result = runNewSliceExpectFail('--restage 555');
  assert.strictEqual(result.code, 1, 'should exit with code 1');
  assert.ok(result.stderr.includes('555'), 'error message should name the id');
  assert.ok(result.stderr.includes('no prior history'), 'error message should mention no prior history');
});

// AC7: rejects id currently active (IN_PROGRESS)
test('AC7: rejects --restage when slice is IN_PROGRESS (exit 1)', () => {
  writeReg([
    { ts: '2026-04-01T00:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
  ]);
  // Simulate active state
  fs.writeFileSync(path.join(QUEUE, '999-IN_PROGRESS.md'), '# active\n', 'utf8');

  const result = runNewSliceExpectFail('--restage 999');
  assert.strictEqual(result.code, 1, 'should exit with code 1');
  assert.ok(result.stderr.includes('999'),        'error message should name the id');
  assert.ok(result.stderr.includes('IN_PROGRESS'), 'error message should name the active state');
});

// AC8: without --restage, existing flow is unchanged (max+1 ID)
test('AC8: without --restage, normal max+1 ID assignment unchanged', () => {
  // Seed queue with a highest id of 050
  writeQueueFile('050', 'DONE');
  writeReg([]);

  runNewSlice('');

  // Should have created 051-STAGED.md, not 050 or anything else
  assert.ok(stagedFileExists('051'), 'bridge/staged/051-STAGED.md should exist');
  assert.ok(!stagedFileExists('050'), 'bridge/staged/050-STAGED.md should NOT exist');
});

// AC9a: second re-stage artifacts get .attempt2
test('AC9a: second re-stage gets .attempt2 suffix', () => {
  writeReg([
    { ts: '2026-04-01T00:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
  ]);
  // Seed first-attempt trash files (simulating a prior manual or automated restage)
  writeTrashFile('999', 'DONE', 1);
  writeTrashFile('999', 'PARKED', 1);
  // Add a new terminal file to archive on this restage
  writeQueueFile('999', 'NOG');

  runNewSlice('--restage 999');

  assert.ok(trashFileExists('999', 'NOG', 2),    'bridge/trash/999-NOG.md.attempt2 should exist');
  assert.ok(trashFileExists('999', 'DONE', 1),   'bridge/trash/999-DONE.md.attempt1 should still exist');
  assert.ok(trashFileExists('999', 'PARKED', 1), 'bridge/trash/999-PARKED.md.attempt1 should still exist');
});

// AC9b: second re-stage renames branch to attempt2
test('AC9b: second re-stage renames branch to slice/999-attempt2', () => {
  writeReg([
    { ts: '2026-04-01T00:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
  ]);
  writeTrashFile('999', 'DONE', 1);
  writeQueueFile('999', 'NOG');

  // branch to rename
  createBranch('slice/999');
  branchesCreated.push('slice/999', 'slice/999-attempt2');

  runNewSlice('--restage 999');

  assert.ok(!branchExists('slice/999'),          'slice/999 should no longer exist');
  assert.ok(branchExists('slice/999-attempt2'),  'slice/999-attempt2 should now exist');
});

// Negative: active state STAGED is detected
test('AC7b: rejects --restage when STAGED file exists (exit 1)', () => {
  writeReg([
    { ts: '2026-04-01T00:00:00.000Z', event: 'COMMISSIONED', slice_id: '999' },
  ]);
  fs.writeFileSync(path.join(STAGED, '999-STAGED.md'), '# staged\n', 'utf8');

  const result = runNewSliceExpectFail('--restage 999');
  assert.strictEqual(result.code, 1, 'should exit with code 1');
  assert.ok(result.stderr.includes('STAGED'), 'error message should name the STAGED state');
});

// ---------------------------------------------------------------------------
// Cleanup — remove any git branches we created
// ---------------------------------------------------------------------------

for (const b of [...new Set(branchesCreated)]) {
  deleteBranch(b);
}

try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch (_) {}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
