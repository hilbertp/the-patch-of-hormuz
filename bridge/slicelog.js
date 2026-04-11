'use strict';

const fs = require('fs');
const path = require('path');

const SLICELOG_FILE = path.resolve(__dirname, 'slicelog.jsonl');

/**
 * appendSliceLog(entry)
 *
 * Appends a single JSON line to bridge/slicelog.jsonl.
 * Called at Write Point 1 (DONE) and Write Point 2 (terminal state update).
 * Will also be called by the future Ruflo runner.
 */
function appendSliceLog(entry) {
  try {
    fs.appendFileSync(SLICELOG_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    // Slicelog write failure must not crash the watcher.
    process.stderr.write('[slicelog-write-error] ' + err.message + '\n');
  }
}

/**
 * updateSliceLog(id, updates)
 *
 * Reads slicelog.jsonl, finds the entry by id, merges updates, rewrites the file.
 * If the entry doesn't exist, creates a new one with updates and recovered: true.
 */
function updateSliceLog(id, updates) {
  let lines = [];
  try {
    const raw = fs.readFileSync(SLICELOG_FILE, 'utf-8').trim();
    if (raw) lines = raw.split('\n');
  } catch (_) {
    // File doesn't exist yet — will create with recovered entry.
  }

  let found = false;
  const updated = lines.map(line => {
    try {
      const entry = JSON.parse(line);
      if (entry.id === String(id)) {
        found = true;
        return JSON.stringify(Object.assign(entry, updates));
      }
    } catch (_) {}
    return line;
  });

  if (!found) {
    // Watcher restarted mid-flight — create recovered entry.
    const recovered = Object.assign({ id: String(id), recovered: true }, updates);
    updated.push(JSON.stringify(recovered));
  }

  try {
    fs.writeFileSync(SLICELOG_FILE, updated.join('\n') + '\n');
  } catch (err) {
    process.stderr.write('[slicelog-update-error] ' + err.message + '\n');
  }
}

module.exports = { appendSliceLog, updateSliceLog, SLICELOG_FILE };
