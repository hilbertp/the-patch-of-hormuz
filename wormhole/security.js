const path = require('path');
const fs = require('fs');

function safePath(relativePath, workspaceRoot) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('Path must be a non-empty string');
  }

  if (path.isAbsolute(relativePath)) {
    throw new Error(`Absolute paths are not allowed: ${relativePath}`);
  }

  if (relativePath.split(path.sep).includes('..') || relativePath.split('/').includes('..')) {
    throw new Error(`Path traversal ("..") is not allowed: ${relativePath}`);
  }

  // Canonicalize workspace root to handle symlinks in the root itself (e.g. /tmp → /private/tmp)
  const realRoot = fs.realpathSync(workspaceRoot);
  const resolved = path.resolve(realRoot, relativePath);

  // Check symlink escape: resolve the real path if the target exists
  let canonical = resolved;
  try {
    canonical = fs.realpathSync(resolved);
  } catch (err) {
    // Target doesn't exist yet — walk up to the nearest existing ancestor
    // and verify that ancestor is inside the workspace
    let dir = path.dirname(resolved);
    while (dir !== path.dirname(dir)) {
      try {
        const realDir = fs.realpathSync(dir);
        if (!realDir.startsWith(realRoot + path.sep) && realDir !== realRoot) {
          throw new Error(`Path resolves outside workspace after symlink resolution: ${relativePath}`);
        }
        break;
      } catch (innerErr) {
        if (innerErr.code === 'ENOENT') {
          dir = path.dirname(dir);
          continue;
        }
        throw innerErr;
      }
    }
  }

  if (!canonical.startsWith(realRoot + path.sep) && canonical !== realRoot) {
    throw new Error(`Path resolves outside workspace: ${relativePath}`);
  }

  return resolved;
}

module.exports = { safePath };
