const fs = require('fs');
const path = require('path');

const raw = process.env.WORMHOLE_WORKSPACE_ROOT;

if (!raw) {
  process.stderr.write('FATAL: WORMHOLE_WORKSPACE_ROOT is not set\n');
  process.exit(1);
}

const WORKSPACE_ROOT = path.resolve(raw);

try {
  const stat = fs.statSync(WORKSPACE_ROOT);
  if (!stat.isDirectory()) {
    process.stderr.write(`FATAL: WORMHOLE_WORKSPACE_ROOT is not a directory: ${WORKSPACE_ROOT}\n`);
    process.exit(1);
  }
} catch (err) {
  process.stderr.write(`FATAL: WORMHOLE_WORKSPACE_ROOT does not exist: ${WORKSPACE_ROOT}\n`);
  process.exit(1);
}

module.exports = { WORKSPACE_ROOT };
