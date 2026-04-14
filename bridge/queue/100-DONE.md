---
id: "100"
title: "F-05 Ops Center — Slice Detail overlay"
from: obrien
to: kira
status: DONE
brief_id: "100"
branch: "slice/100-slice-detail-overlay"
completed: "2026-04-15T00:12:00.000Z"
tokens_in: 85000
tokens_out: 8500
elapsed_ms: 420000
estimated_human_hours: 3.0
compaction_occurred: false
---

## Summary

Built the Slice Detail overlay, triggered by `[Edit]` on any queue row. Full-width overlay over the dashboard with two tabs and context-aware action buttons.

## What was done

### 1. Overlay structure (`lcars-dashboard.html`)
- Full-width fixed overlay with backdrop, panel, header (ID + title + close button), tab bar, scrollable body, and actions footer
- Two tabs: **Rendered** (default) and **Source**
- Dismiss via `✕ close` button, Escape key, or backdrop click

### 2. Rendered tab
- Parses markdown body into sections (Goal, Context, Scope, Constraints, Tasks, Acceptance Criteria)
- Acceptance Criteria rendered with larger text (`15px`), bolder weight, and distinct styling via `.slice-rendered-criteria`
- Uses `marked.js` (already loaded) for markdown rendering within sections
- Falls back to full-body render if no sections are detected

### 3. Source tab
- Textarea with raw markdown body, monospace font
- Note: "Edit directly — changes are saved to the slice file on disk."
- Edits saved via explicit Save action (not on keystroke)

### 4. Context-aware action buttons

**Staged context:**
- **Approve** — calls existing `/api/bridge/staged/:id/approve`
- **Refine** — prompts for note, calls `/api/bridge/staged/:id/amend`
- **Reject** — confirmation dialog, calls `/api/bridge/staged/:id/reject` (right-aligned, warning style)

**Accepted context:**
- **Save edits** — sends body to `PATCH /api/queue/:id/content`
- **Send to Kira** — confirmation, calls `/api/queue/:id/send-to-kira`
- **Remove from queue** — confirmation, calls `/api/queue/:id/remove` (right-aligned, warning style)

### 5. New server endpoints (`dashboard/server.js`)
- `GET /api/queue/:id/content` — reads raw file (PENDING, STAGED, or NEEDS_AMENDMENT), returns frontmatter + body + raw
- `PATCH /api/queue/:id/content` — updates body of the file (preserves frontmatter)
- `POST /api/queue/:id/remove` — moves PENDING file to trash, removes from queue order, logs `removed` event
- `POST /api/queue/:id/send-to-kira` — moves PENDING to NEEDS_AMENDMENT in staged dir, logs `sent_to_kira` event

## Files changed

- `dashboard/lcars-dashboard.html` — overlay HTML, CSS, and JS
- `dashboard/server.js` — 4 new API endpoints

## Success criteria verification

1. ✅ `[Edit]` on any queue row opens the overlay
2. ✅ Rendered tab shows formatted slice content with prominent Acceptance Criteria
3. ✅ Source tab shows editable raw markdown; Save edits writes to disk
4. ✅ Staged context: Approve/Refine/Reject buttons present and functional
5. ✅ Accepted context: Save edits/Send to Kira/Remove from queue present and functional
6. ✅ `✕ close` and Escape dismiss the overlay
7. ✅ Committed on `slice/100-slice-detail-overlay`
