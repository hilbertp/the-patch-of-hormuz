#!/usr/bin/env bash
# Restore write permissions on source directories in the main repo.
# Called by the watcher before a merge commit, and by Philipp when manual
# edits are needed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- directories (recursive) ---
for dir in dashboard docs/contracts; do
  [ -d "$REPO/$dir" ] && chmod -R u+w "$REPO/$dir"
done

# --- individual bridge JS files ---
for f in "$REPO"/bridge/*.js; do
  [ -f "$f" ] && chmod u+w "$f"
done

# --- top-level files ---
for f in package.json README.md CLAUDE.md; do
  [ -f "$REPO/$f" ] && chmod u+w "$REPO/$f"
done

echo "unlock-main: source paths unlocked (owner-writable)"
