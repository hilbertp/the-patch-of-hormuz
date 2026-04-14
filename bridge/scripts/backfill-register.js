#!/usr/bin/env node
'use strict';

/**
 * backfill-register.js
 *
 * One-time script: writes synthetic DONE events to bridge/register.jsonl
 * for slices 059–083 that completed but have no DONE event in the register.
 *
 * Source of truth: {id}-ACCEPTED.md files in bridge/queue/ (these are the
 * original O'Brien DONE reports, renamed by the evaluator on acceptance).
 *
 * Run: node bridge/scripts/backfill-register.js
 */

const fs   = require('fs');
const path = require('path');

const QUEUE_DIR     = path.resolve(__dirname, '../queue');
const REGISTER_FILE = path.resolve(__dirname, '../register.jsonl');

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const result = {};
  for (const line of match[1].split('\n')) {
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const val = line.slice(sep + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = val;
  }
  return result;
}

// Load existing register events to know which IDs already have a DONE event.
const existing = new Set();
try {
  const lines = fs.readFileSync(REGISTER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e.event === 'DONE') existing.add(e.id);
    } catch (_) {}
  }
} catch (_) {}

console.log(`Existing DONE events: ${[...existing].join(', ')}`);

// Slices to backfill.
const RANGE_START = 59;
const RANGE_END   = 83;

let written = 0;
for (let i = RANGE_START; i <= RANGE_END; i++) {
  const id    = String(i).padStart(3, '0');
  if (existing.has(id)) {
    console.log(`  skip ${id} — DONE already exists`);
    continue;
  }

  // Read ACCEPTED file (O'Brien's original DONE report).
  const acceptedPath = path.join(QUEUE_DIR, `${id}-ACCEPTED.md`);
  let meta = null;
  try {
    const content = fs.readFileSync(acceptedPath, 'utf-8');
    meta = parseFrontmatter(content);
  } catch (_) {
    console.log(`  skip ${id} — no ACCEPTED file`);
    continue;
  }

  if (!meta) {
    console.log(`  skip ${id} — unparseable ACCEPTED file`);
    continue;
  }

  // Build synthetic DONE event.
  // Use the ACCEPTED file's mtime as a proxy for completion time.
  let completedAt;
  try {
    const stat = fs.statSync(acceptedPath);
    completedAt = stat.mtime.toISOString();
  } catch (_) {
    completedAt = new Date().toISOString();
  }

  const durationMs = meta.elapsed_ms ? parseInt(meta.elapsed_ms, 10) : null;
  const tokensIn   = meta.tokens_in  ? parseInt(meta.tokens_in, 10)  : null;
  const tokensOut  = meta.tokens_out ? parseInt(meta.tokens_out, 10) : null;

  const entry = {
    ts:         completedAt,
    id,
    event:      'DONE',
    durationMs: isNaN(durationMs) ? null : durationMs,
    tokensIn:   isNaN(tokensIn)   ? null : tokensIn,
    tokensOut:  isNaN(tokensOut)  ? null : tokensOut,
    costUsd:    null,
    synthetic:  true,   // flag so we know this is a backfill entry
  };

  try {
    fs.appendFileSync(REGISTER_FILE, JSON.stringify(entry) + '\n');
    written++;
    console.log(`  wrote DONE for ${id} (elapsed=${durationMs}ms)`);
  } catch (err) {
    console.error(`  ERROR writing ${id}: ${err.message}`);
  }
}

console.log(`\nDone. Wrote ${written} synthetic DONE events.`);
