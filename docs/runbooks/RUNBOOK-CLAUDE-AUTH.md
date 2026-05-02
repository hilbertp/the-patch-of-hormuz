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
