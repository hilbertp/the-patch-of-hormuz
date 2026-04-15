#!/usr/bin/env node
/**
 * mock-claude-500.js
 *
 * Drop-in replacement for the `claude` binary that immediately exits 1 with
 * the same JSON payload Claude Code produces when the Anthropic API returns
 * HTTP 500 (Internal Server Error).
 *
 * Usage:
 *   Set claudeCommand + claudeArgs in bridge.config.json to point here,
 *   or use run-api-retry.js which sets that up automatically.
 *
 * The watcher writes the slice to stdin; we drain it so the pipe doesn't
 * block, then write the error JSON to stdout and exit 1.
 */
'use strict';

const MOCK_REQUEST_ID = 'req_mock_api_down_test_001';
const MOCK_SESSION_ID = 'mock-session-' + Date.now();

const errorPayload = {
  type:            'result',
  subtype:         'success',
  is_error:        true,
  duration_ms:     250,
  duration_api_ms: 0,
  num_turns:       1,
  result:          `API Error: 500 ${JSON.stringify({
    type:       'error',
    error:      { type: 'api_error', message: 'Internal server error' },
    request_id: MOCK_REQUEST_ID,
  })}`,
  stop_reason:     'stop_sequence',
  session_id:      MOCK_SESSION_ID,
  total_cost_usd:  0,
  usage: {
    input_tokens:                  0,
    cache_creation_input_tokens:   0,
    cache_read_input_tokens:       0,
    output_tokens:                 0,
    server_tool_use:               { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier:                  'standard',
    cache_creation:                { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    inference_geo:                 '',
    iterations:                    [],
    speed:                         'standard',
  },
  modelUsage:        {},
  permission_denials:[],
  terminal_reason:   'completed',
  fast_mode_state:   'off',
  uuid:              MOCK_SESSION_ID,
};

// Drain stdin so the pipe doesn't back-pressure the watcher
process.stdin.resume();
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify(errorPayload) + '\n');
  process.exit(1);
});
