const fs = require('fs');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { WORKSPACE_ROOT } = require('./config.js');
const { safePath } = require('./security.js');
const { log } = require('./logging.js');

const server = new McpServer({
  name: 'wormhole',
  version: '1.0.0'
});

function writeHeartbeat(tool, relativePath) {
  try {
    const heartbeatPath = path.join(WORKSPACE_ROOT, 'bridge', 'wormhole-heartbeat.json');
    fs.mkdirSync(path.dirname(heartbeatPath), { recursive: true });
    fs.writeFileSync(heartbeatPath, JSON.stringify({
      ts: new Date().toISOString(),
      tool,
      path: relativePath
    }) + '\n');
  } catch (err) {
    log('warn', 'Failed to write heartbeat', { error: err.message });
  }
}

// wormhole_write_file
server.tool(
  'wormhole_write_file',
  'Write or overwrite a file in the workspace',
  {
    path: z.string().describe('Relative path within workspace'),
    content: z.string().describe('File content'),
    options: z.object({
      encoding: z.string().default('utf-8')
    }).optional()
  },
  async ({ path: relPath, content, options }) => {
    try {
      const absPath = safePath(relPath, WORKSPACE_ROOT);
      const encoding = (options && options.encoding) || 'utf-8';
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, { encoding });
      log('info', 'write_file', { path: relPath });
      writeHeartbeat('wormhole_write_file', relPath);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, path: relPath }) }] };
    } catch (err) {
      log('error', 'write_file failed', { path: relPath, error: err.message });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }], isError: true };
    }
  }
);

// wormhole_append_jsonl
server.tool(
  'wormhole_append_jsonl',
  'Append a JSON line to a file in the workspace',
  {
    path: z.string().describe('Relative path within workspace'),
    line: z.any().describe('JSON object to append')
  },
  async ({ path: relPath, line }) => {
    try {
      // Validate line is a valid JSON object
      if (typeof line !== 'object' || line === null || Array.isArray(line)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'line must be a JSON object' }) }],
          isError: true
        };
      }
      const absPath = safePath(relPath, WORKSPACE_ROOT);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.appendFileSync(absPath, JSON.stringify(line) + '\n');
      log('info', 'append_jsonl', { path: relPath });
      writeHeartbeat('wormhole_append_jsonl', relPath);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, path: relPath }) }] };
    } catch (err) {
      log('error', 'append_jsonl failed', { path: relPath, error: err.message });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }], isError: true };
    }
  }
);

// wormhole_move
server.tool(
  'wormhole_move',
  'Move/rename a file within the workspace',
  {
    from: z.string().describe('Source relative path'),
    to: z.string().describe('Destination relative path')
  },
  async ({ from, to }) => {
    try {
      const absFrom = safePath(from, WORKSPACE_ROOT);
      const absTo = safePath(to, WORKSPACE_ROOT);
      fs.mkdirSync(path.dirname(absTo), { recursive: true });
      fs.renameSync(absFrom, absTo);
      log('info', 'move', { from, to });
      writeHeartbeat('wormhole_move', to);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, from, to }) }] };
    } catch (err) {
      log('error', 'move failed', { from, to, error: err.message });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }], isError: true };
    }
  }
);

// wormhole_delete
server.tool(
  'wormhole_delete',
  'Delete a single file in the workspace',
  {
    path: z.string().describe('Relative path within workspace')
  },
  async ({ path: relPath }) => {
    try {
      const absPath = safePath(relPath, WORKSPACE_ROOT);
      fs.unlinkSync(absPath);
      log('info', 'delete', { path: relPath });
      writeHeartbeat('wormhole_delete', relPath);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, path: relPath }) }] };
    } catch (err) {
      log('error', 'delete failed', { path: relPath, error: err.message });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }], isError: true };
    }
  }
);

// wormhole_ping
server.tool(
  'wormhole_ping',
  'Health check — writes a nonce to bridge/wormhole-ping.json',
  {
    nonce: z.string().describe('Short string nonce for verification')
  },
  async ({ nonce }) => {
    try {
      const ts = new Date().toISOString();
      const pingPath = path.join(WORKSPACE_ROOT, 'bridge', 'wormhole-ping.json');
      fs.mkdirSync(path.dirname(pingPath), { recursive: true });
      fs.writeFileSync(pingPath, JSON.stringify({ nonce, ts }) + '\n');
      log('info', 'ping', { nonce });
      writeHeartbeat('wormhole_ping', 'bridge/wormhole-ping.json');
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, nonce, ts }) }] };
    } catch (err) {
      log('error', 'ping failed', { error: err.message });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }], isError: true };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'Wormhole MCP server started', { workspace: WORKSPACE_ROOT });
}

main().catch((err) => {
  log('error', 'Fatal startup error', { error: err.message });
  process.exit(1);
});
