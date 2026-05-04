'use strict';

const fs = require('fs');
const path = require('path');

const REGISTER_PATH = path.resolve(__dirname, '..', 'register.jsonl');

/**
 * getRecentGateEvents(limit = 50)
 *
 * Reads register.jsonl and returns the last `limit` events whose
 * `event` field starts with "gate-". Returns an array of parsed objects,
 * oldest-first. Returns [] if the file is missing or empty.
 */
function getRecentGateEvents(limit = 50) {
  let raw;
  try {
    raw = fs.readFileSync(REGISTER_PATH, 'utf-8').trim();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  if (!raw) return [];

  const gateEvents = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.event && entry.event.startsWith('gate-')) {
        gateEvents.push(entry);
      }
    } catch (_) {
      // Skip malformed lines — best effort
    }
  }

  return gateEvents.slice(-limit);
}

module.exports = { getRecentGateEvents, REGISTER_PATH };
