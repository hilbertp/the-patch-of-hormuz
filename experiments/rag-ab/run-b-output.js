'use strict';

const fs = require('fs');
const path = require('path');

const REGISTER_PATH = path.resolve(__dirname, '..', 'register.jsonl');

/**
 * getRecentGateEvents(limit = 50)
 *
 * Reads bridge/register.jsonl and returns the last `limit` events
 * whose `event` field starts with "gate-", parsed as objects.
 * Returns an empty array if the file is missing or empty.
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
      const parsed = JSON.parse(line);
      if (parsed.event && parsed.event.startsWith('gate-')) {
        gateEvents.push(parsed);
      }
    } catch (_) { /* skip malformed lines */ }
  }

  return gateEvents.slice(-limit);
}

module.exports = { getRecentGateEvents, REGISTER_PATH };
