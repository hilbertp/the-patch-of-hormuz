#!/usr/bin/env bash
# Lock source directories in the main repo so O'Brien's Write/Edit tool calls
# get "Permission denied". Run after merge to activate Layer 2 enforcement.
#
# Paths NOT locked (O'Brien must write here):
#   bridge/staged/, bridge/queue/, bridge/trash/
#   .auto-memory/, .claude/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- directories (recursive) ---
for dir in dashboard docs/contracts; do
  [ -d "$REPO/$dir" ] && chmod -R a-w "$REPO/$dir"
done

# --- individual bridge JS files ---
for f in "$REPO"/bridge/*.js; do
  [ -f "$f" ] && chmod a-w "$f"
done

# --- top-level files ---
for f in package.json README.md CLAUDE.md; do
  [ -f "$REPO/$f" ] && chmod a-w "$REPO/$f"
done

echo "lock-main: source paths locked (read-only)"
