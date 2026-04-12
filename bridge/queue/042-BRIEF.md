---
id: "042"
title: "Stakeholder review gate — staged commissions with Commission / Amend / Reject"
goal: "Kira writes commissions to a staging area. Philipp reviews each one and clicks Commission, Amend, or Reject before anything enters the queue."
from: kira
to: obrien
priority: high
created: "2026-04-09T21:00:00Z"
references: null
timeout_min: null
---

## Objective

Right now Kira writes directly to `bridge/queue/` and the watcher picks up immediately — no review moment for Philipp. This commission builds a staging gate: commissions sit in `bridge/staged/` until Philipp approves them. Nothing enters the queue automatically.

## New directory structure

```
bridge/
  queue/    — unchanged. only files here trigger O'Brien.
  staged/   — new. Kira writes here. never auto-executed.
  trash/    — new. rejected commissions land here.
```

## Lifecycle

```
Kira writes {id}-STAGED.md
  → Commission  →  moved to queue/{id}-PENDING.md  →  O'Brien picks up
  → Amend       →  Philipp types a note  →  file gets amendment_note + NEEDS_AMENDMENT status  →  Kira rewrites and restages
  → Reject      →  moved to trash/{id}-REJECTED.md
```

Note on Amend: Philipp types a short note explaining what to change. The file stays in staged/ with status NEEDS_AMENDMENT and amendment_note set. Kira reads the note in the next session, rewrites the commission, and puts a new version back in staged/ for Philipp to review again.

---

## Dashboard — staged panel UI

The staged panel must be **stakeholder-friendly**. Philipp needs to understand what he's approving without reading O'Brien's technical instructions.

Each staged commission shows:

```
┌─────────────────────────────────────────────────────┐
│ #042  Stakeholder review gate                        │
│ Kira wants to build a staging area so you can        │
│ review commissions before they go to O'Brien.        │
│                                                      │
│ [Commission]  [Amend]  [Reject]                      │
│                                                      │
│ ▸ Details                                            │  ← collapsible
└─────────────────────────────────────────────────────┘
```

**Title line**: `#{id}  {title}` (from frontmatter)
**Summary**: one or two plain-English sentences from a `summary:` frontmatter field (Kira writes this for Philipp — separate from the technical goal). Fall back to `goal:` if no `summary:` field.
**Buttons**: Commission | Amend | Reject
**Details** (collapsed by default): full commission body including O'Brien's instructions

### Button behavior

**Commission**: POST `/api/bridge/staged/{id}/commission` → moves to queue as PENDING → remove card from panel.

**Amend**: Show a text input inline ("What should change?"). On submit: POST `/api/bridge/staged/{id}/amend` with `{ note }` → card updates to show "Awaiting Kira's revision" + the note text.

**Reject**: Show inline confirm ("Reject this commission?"). On confirm: POST `/api/bridge/staged/{id}/reject` → card removed from panel.

If staged/ is empty: show `No commissions awaiting review.`

---

## API — new endpoints in `dashboard/server.js`

**GET /api/bridge/staged**
Read all `*-STAGED.md` files in `bridge/staged/`. Return array of `{ id, title, summary, goal, status, amendment_note, body }`.

**POST /api/bridge/staged/:id/commission**
- Read `bridge/staged/{id}-STAGED.md`
- Write to `bridge/queue/{id}-PENDING.md` (update status: PENDING in frontmatter)
- Delete from staged/
- Return `{ ok: true }`

**POST /api/bridge/staged/:id/amend**
- Body: `{ note: "..." }`
- Update frontmatter of `bridge/staged/{id}-STAGED.md`: set `status: NEEDS_AMENDMENT`, `amendment_note: "{note}"`
- Return `{ ok: true }`

**POST /api/bridge/staged/:id/reject**
- Move to `bridge/trash/{id}-REJECTED.md`, set `status: REJECTED` in frontmatter
- Return `{ ok: true }`

---

## Watcher changes in `bridge/watcher.js`

In `crashRecovery()`: after handling IN_PROGRESS and EVALUATING files, add a startup log:
```
ℹ  {n} commission(s) awaiting your review in bridge/staged/
```
Never auto-process staged/ files. Never scan staged/ for PENDING or DONE patterns.

---

## Frontmatter addition (for Kira going forward)

All future STAGED files Kira writes must include a `summary:` field — 1-2 plain sentences for Philipp. Example:

```yaml
summary: "Build the staged commission panel so you can review and approve commissions before O'Brien picks them up."
```

---

## Constraints

- Existing queue lifecycle unchanged.
- Create `bridge/staged/` and `bridge/trash/` if they don't exist.
- API handles missing files gracefully (404).
- No authentication — local only.
- Amend does NOT open a file editor. It captures Philipp's text note only. Kira handles the rewrite.

## Success Criteria

- [ ] `bridge/staged/` and `bridge/trash/` directories created
- [ ] `GET /api/bridge/staged` returns staged commissions with id, title, summary, goal, status, amendment_note, body
- [ ] `POST /api/bridge/staged/:id/commission` moves to queue as PENDING
- [ ] `POST /api/bridge/staged/:id/amend` stores note + NEEDS_AMENDMENT status
- [ ] `POST /api/bridge/staged/:id/reject` moves to trash
- [ ] Dashboard staged panel shows title, summary, and Commission / Amend / Reject buttons
- [ ] Details section (full body) is collapsible, collapsed by default
- [ ] Amend flow shows inline text input, no browser prompt()
- [ ] Reject flow shows inline confirmation, no browser confirm()
- [ ] Watcher logs staged count on startup, never processes staged files
- [ ] Existing queue behavior unchanged
