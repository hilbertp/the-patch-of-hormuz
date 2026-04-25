#!/usr/bin/env bash
# chmod-guard.sh — Wrapper around /bin/chmod that refuses to make locked
# paths writable unless the orchestrator has opened the lock via unlock-main.sh.
#
# Lock state is signalled by the marker file bridge/.main-unlocked.
# When the marker exists, the guard passes through to the real chmod.
# When absent, any attempt to grant write permission on a locked path fails
# with guidance directing the operator to the unlock protocol.
#
# Locked paths (mirrors lock-main.sh):
#   dashboard/       docs/contracts/      bridge/*.js
#   package.json     README.md            CLAUDE.md
#
# Usage:
#   Activated via scripts/activate-guard.sh (prepends a bin/ shim to PATH).
#   Do NOT call directly — symlink in bin/chmod calls this.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
REAL_CHMOD="/bin/chmod"
MARKER="$REPO/bridge/.main-unlocked"

# ---------------------------------------------------------------------------
# Parse arguments: separate flags from mode and file list.
# chmod syntax: chmod [-R] [-v] [-f] MODE FILE [FILE ...]
# We need to extract the mode (first non-flag argument) and the files.
# ---------------------------------------------------------------------------
flags=()
mode=""
files=()
parsing_mode=true  # true = still looking for mode, false = collecting files

for arg in "$@"; do
  if $parsing_mode; then
    case "$arg" in
      -*)
        flags+=("$arg")
        ;;
      *)
        mode="$arg"
        parsing_mode=false
        ;;
    esac
  else
    files+=("$arg")
  fi
done

# If we couldn't parse a mode (e.g. bare chmod with no args), pass through.
if [ -z "$mode" ]; then
  exec "$REAL_CHMOD" "$@"
fi

# ---------------------------------------------------------------------------
# Determine whether the mode grants write permission.
# ---------------------------------------------------------------------------
grants_write=false

# Numeric mode: write bit in user octet (hundreds digit) is bit 2 (value 2).
# User digit ≥ 6 means write is set (6=rw, 7=rwx).
if echo "$mode" | grep -qE '^[0-7]{3,4}$'; then
  # Extract user octet (rightmost 3 digits, hundreds position)
  digits="${mode: -3}"   # last 3 digits
  user_digit="${digits:0:1}"
  if [ "$user_digit" -ge 6 ] 2>/dev/null; then
    grants_write=true
  fi
else
  # Symbolic mode: look for write grant patterns.
  # Matches: +w  u+w  a+w  g+w  o+w  ug+w  ugo+w  etc.
  # Does NOT match a-w or u-w (those remove write).
  if echo "$mode" | grep -qE '(\+w|[ugoa]*\+[rwx]*w)'; then
    grants_write=true
  fi
fi

# If the mode doesn't grant write, pass through — nothing to guard.
if ! $grants_write; then
  exec "$REAL_CHMOD" "${flags[@]+"${flags[@]}"}" "$mode" "${files[@]+"${files[@]}"}"
fi

# ---------------------------------------------------------------------------
# Determine whether any of the target files are locked paths.
# ---------------------------------------------------------------------------
is_locked_path() {
  local f="$1"
  # Normalise: strip leading ./
  f="${f#./}"
  case "$f" in
    dashboard|dashboard/*)              return 0 ;;
    docs/contracts|docs/contracts/*)    return 0 ;;
    bridge/*.js)                        return 0 ;;
    package.json|README.md|CLAUDE.md)   return 0 ;;
  esac
  # Also match by basename for bridge JS files passed as relative paths
  local base
  base="$(basename "$f")"
  case "$base" in
    *.js)
      # Only guard bridge/*.js, not arbitrary JS files
      if echo "$f" | grep -q 'bridge/'; then
        return 0
      fi
      ;;
  esac
  return 1
}

has_locked=false
for f in "${files[@]+"${files[@]}"}"; do
  if is_locked_path "$f"; then
    has_locked=true
    break
  fi
done

# If no locked path is targeted, pass through.
if ! $has_locked; then
  exec "$REAL_CHMOD" "${flags[@]+"${flags[@]}"}" "$mode" "${files[@]+"${files[@]}"}"
fi

# ---------------------------------------------------------------------------
# Locked path + write-grant: check marker file.
# ---------------------------------------------------------------------------
if [ -f "$MARKER" ]; then
  # Orchestrator has the lock open — allow.
  exec "$REAL_CHMOD" "${flags[@]+"${flags[@]}"}" "$mode" "${files[@]+"${files[@]}"}"
fi

# Marker absent — refuse and guide the operator.
cat >&2 <<'MSG'
chmod-guard: refusing to make locked path writable.
The orchestrator owns main. To unlock manually:

    bash scripts/unlock-main.sh && <your op> && bash scripts/lock-main.sh

See .auto-memory/feedback_main_lock_protocol.md for the full protocol.
MSG
exit 1
