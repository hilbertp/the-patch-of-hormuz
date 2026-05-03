# Runbook: Claude Authentication Failure

## Symptom

Slices error with `claude -p` 401 / "Invalid authentication credentials".

## Cause

`ANTHROPIC_API_KEY` either not set in `.env` or `.env` not loaded by the orchestrator (regression if the `--env-file` plist change is reverted).

## Fix

1. Get a fresh API key from https://console.anthropic.com/settings/keys.
2. Edit `.env` at repo root: `ANTHROPIC_API_KEY=sk-ant-api03-...`.
3. Restart the orchestrator:
   ```bash
   bash scripts/orch-stop.sh && bash scripts/orch-start.sh
   ```
4. Verify the agent is running:
   ```bash
   launchctl list dev.liberation.orchestrator | grep PID
   ```
   Stage a smoke slice to confirm auth works end-to-end.

## Note

`.env` is gitignored. Never commit a real key. The plist is tracked — never put a key in the plist.

---

## Switching merge strategy

The `DS9_USE_GATE_FLOW` env var controls how ACCEPTED slices land:

| Value | Behavior |
|-------|----------|
| `0` (default) | Legacy: `mergeBranch` merges directly to main |
| `1` | Gate flow: `squashSliceToDev` squashes to dev; Bashir gates dev → main |

**When to flip to `1`:** Only after O'Brien's Bashir manual-trigger wiring is complete and verified. Without Bashir, slices accumulate on dev with no path to main.

**How to flip:**
1. Set `DS9_USE_GATE_FLOW=1` in `.env`.
2. Restart the orchestrator: `bash scripts/orch-stop.sh && bash scripts/orch-start.sh`.
3. Confirm startup log shows "Active merge strategy: GATE FLOW".
