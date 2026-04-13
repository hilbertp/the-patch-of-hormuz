---
name: check-handoffs
description: "Scan the project folder for handoff files addressed to the current role. Use when starting a new session, when someone says 'check your handoffs', 'any handoffs for me?', 'what's waiting for me?', or when a role needs to pick up work left by another role."
---

# Check Handoffs

You are checking the project for handoff files addressed to you (the current role).

## How it works

Handoff files follow the naming convention `HANDOFF-*.md` and live in the role's **inbox subfolder**: `repo/.claude/roles/{role-name}/inbox/`. This is the only place to look — never the role root, never the sender's folder.

## T&T Self-Audit (run before inbox scan)

Before checking for handoffs, verify that your previous session's time was logged:

1. **Identify your role name** (lowercase, e.g. `dax`, `kira`, `sisko`).

2. **Read `bridge/tt-audit.jsonl`.** Find the most recent line where `"role"` matches your role name.
   - If **no entry exists** for your role — skip this entire self-audit. This is your first session; there's nothing to check.

3. **If an entry is found**, note its `ts` value. Read `bridge/timesheet.jsonl`. Look for any line where `"role"` matches your role name **and** `"ts"` is chronologically after the audit entry's `ts`.

4. **If no timesheet entry is found** after that timestamp, display this warning prominently:

   > ⚠️ **T&T gap detected.** No timesheet entry found since your last outbound handoff (`<ts from audit entry>`). Run `ds9:estimate-hours` to log your previous session before proceeding.

   **Do not block.** Show the warning and then continue to the inbox scan below.

5. **If a matching timesheet entry is found** — no warning needed. Proceed normally.

---

## Token Snapshot — Session Open

Run the following command after the T&T self-audit, before the inbox scan:

```bash
node bridge/usage-snapshot.js --silent --log
```

This captures a baseline token snapshot for this session. Non-blocking — if it warns about an expired key, tell Philipp, but continue to the inbox scan regardless.

---

## Steps

1. **Identify your role name.** Check which DS9 role you are currently operating as (e.g., ziyal, sisko, kira, dax, leeta, obrien, bashir, nog, worf, odo).

2. **Check your inbox.** All incoming handoffs live in your inbox folder:
   ```
   repo/.claude/roles/{your-role-name}/inbox/
   ```
   List all files: `ls -lt repo/.claude/roles/{your-role-name}/inbox/`

   This is the **only** place to look. Handoffs are always written to the receiver's inbox by the `/handoff-to-teammate` skill. Never search the sender's folder — handoffs addressed to you won't be there.

3. **Report what you found.** For each handoff file:
   - File path
   - Who it's from (check the "From:" line if present)
   - Date
   - One-line summary of the task or context

4. **If no handoffs found**, say so clearly: "No handoff files found for {role}. Nothing waiting."

## After finding handoffs

Read the handoff file(s) and confirm with the user before acting on them. A handoff is an instruction set — don't start executing until the user says go.
