#!/usr/bin/env bash
# activate-guard.sh — Prepend the repo's bin/ shim directory to PATH so that
# `chmod` calls in this shell hit chmod-guard.sh before /bin/chmod.
#
# Usage (source from your shell rc, or run once per session):
#   source scripts/activate-guard.sh
#
# What it does:
#   1. Resolves the repo root from this script's location.
#   2. Creates bin/ and a bin/chmod symlink pointing at scripts/chmod-guard.sh
#      (idempotent — skips if symlink already exists).
#   3. Prepends <repo>/bin to PATH (idempotent — skips if already there).
#
# To deactivate: open a new shell, or remove <repo>/bin from PATH manually.

GUARD_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
GUARD_REPO="$(cd "$GUARD_SCRIPT_DIR/.." && pwd)"
GUARD_BIN="$GUARD_REPO/bin"

# Create bin/ and symlink if needed.
mkdir -p "$GUARD_BIN"
if [ ! -e "$GUARD_BIN/chmod" ]; then
  ln -s "$GUARD_SCRIPT_DIR/chmod-guard.sh" "$GUARD_BIN/chmod"
  echo "activate-guard: created $GUARD_BIN/chmod -> scripts/chmod-guard.sh"
fi

# Prepend to PATH only if not already present.
case ":$PATH:" in
  *":$GUARD_BIN:"*)
    echo "activate-guard: $GUARD_BIN already in PATH — no change"
    ;;
  *)
    export PATH="$GUARD_BIN:$PATH"
    echo "activate-guard: prepended $GUARD_BIN to PATH"
    ;;
esac
