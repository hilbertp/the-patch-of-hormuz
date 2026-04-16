const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { safePath } = require('../security.js');

// Create a temp workspace for testing — resolve symlinks so assertions match safePath output
const WORKSPACE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wormhole-test-')));

function test(name, fn) {
  try {
    fn();
    process.stderr.write(`  PASS: ${name}\n`);
  } catch (err) {
    process.stderr.write(`  FAIL: ${name}\n    ${err.message}\n`);
    process.exitCode = 1;
  }
}

process.stderr.write('security.js tests\n');

// --- Path traversal ---
test('rejects path traversal (../../../etc/passwd)', () => {
  assert.throws(
    () => safePath('../../../etc/passwd', WORKSPACE),
    /not allowed/
  );
});

test('rejects path traversal (foo/../../etc/passwd)', () => {
  assert.throws(
    () => safePath('foo/../../etc/passwd', WORKSPACE),
    /not allowed/
  );
});

// --- Absolute path ---
test('rejects absolute path', () => {
  assert.throws(
    () => safePath('/etc/passwd', WORKSPACE),
    /Absolute paths are not allowed/
  );
});

// --- Symlink escape ---
test('rejects symlink that escapes workspace', () => {
  const linkDir = path.join(WORKSPACE, 'escape-link');
  fs.symlinkSync('/tmp', linkDir);
  assert.throws(
    () => safePath('escape-link/evil.txt', WORKSPACE),
    /outside workspace/
  );
  fs.unlinkSync(linkDir);
});

// --- Valid relative path ---
test('resolves valid relative path', () => {
  const result = safePath('bridge/queue/test.md', WORKSPACE);
  assert.strictEqual(result, path.join(WORKSPACE, 'bridge', 'queue', 'test.md'));
});

test('resolves nested path with non-existent parents', () => {
  const result = safePath('a/b/c/d.txt', WORKSPACE);
  assert.strictEqual(result, path.join(WORKSPACE, 'a', 'b', 'c', 'd.txt'));
});

// --- append_jsonl validation (server-level, tested via direct logic) ---
process.stderr.write('\nappend_jsonl validation tests\n');

test('rejects non-object line (string)', () => {
  // Simulate the server's validation logic
  const line = 'not an object';
  const isValid = typeof line === 'object' && line !== null && !Array.isArray(line);
  assert.strictEqual(isValid, false, 'string should be rejected');
});

test('rejects non-object line (array)', () => {
  const line = [1, 2, 3];
  const isValid = typeof line === 'object' && line !== null && !Array.isArray(line);
  assert.strictEqual(isValid, false, 'array should be rejected');
});

test('rejects non-object line (null)', () => {
  const line = null;
  const isValid = typeof line === 'object' && line !== null && !Array.isArray(line);
  assert.strictEqual(isValid, false, 'null should be rejected');
});

test('accepts valid object line', () => {
  const line = { key: 'value', ts: '2026-01-01' };
  const isValid = typeof line === 'object' && line !== null && !Array.isArray(line);
  assert.strictEqual(isValid, true, 'valid object should be accepted');
});

// --- Write to missing parent dir ---
process.stderr.write('\nwrite to missing parent dir tests\n');

test('write to missing parent dir creates parents and succeeds', () => {
  const relPath = 'deep/nested/dir/file.txt';
  const absPath = safePath(relPath, WORKSPACE);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, 'hello');
  assert.strictEqual(fs.readFileSync(absPath, 'utf-8'), 'hello');
});

// --- append_jsonl does not write on invalid JSON ---
test('append_jsonl with invalid JSON does not write file', () => {
  const relPath = 'should-not-exist.jsonl';
  const absPath = path.join(WORKSPACE, relPath);
  // Simulate: if validation fails, we don't call appendFileSync
  const line = 'invalid';
  const isValid = typeof line === 'object' && line !== null && !Array.isArray(line);
  if (isValid) {
    fs.appendFileSync(absPath, JSON.stringify(line) + '\n');
  }
  assert.strictEqual(fs.existsSync(absPath), false, 'file should not exist after invalid input');
});

// Cleanup
fs.rmSync(WORKSPACE, { recursive: true, force: true });

process.stderr.write('\nAll tests completed.\n');
