#!/usr/bin/env bash
# Point this repo's hook directory at the tracked scripts/hooks/ folder
# so the pre-commit hook is always present on every clone.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

git -C "$REPO_DIR" config core.hooksPath scripts/hooks
echo "core.hooksPath set to scripts/hooks"
