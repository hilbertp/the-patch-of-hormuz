---
id: J-direct-controls-ops-ui
category: direct-controls
status: draft
last_reviewed: 2026-05-08
---

# Direct controls: every Ops UI button, toggle, and interaction

## What the user is trying to accomplish

Reference catalog of every clickable, draggable, or keyboard-accessible surface in the Ops Center dashboard. This journey is a listing, not a typical user flow.

## Preconditions

- Ops Center is running and fully loaded
- User is viewing the dashboard with a functioning browser
- All panels are visible (or collapsed but available to toggle)

## Controls — per panel

### Header

| Control | Action | Expected behavior |
|---------|--------|-------------------|
| App name ("Ops") | Click | Navigate to dashboard root (no-op if already there) |
| Health pill | Hover | Tooltip appears: "Orchestrator · {state} · last heartbeat {age}" |
| Health pill | Click | (Future) may open detailed status; currently no action |
| Clock | View only | Displays server time in HH:MM:SS format (24-hour) |

### Branch Topology panel

| Control | Action | Expected behavior |
|---------|--------|-------------------|
| Collapse toggle (chevron) | Click | Toggle `.topo-collapsed` state; chevron rotates 90°; body hides, mini-graph shows |
| Commit dot (dev or main) | Hover | Scale to 1.15; tooltip shows commit SHA and subject |
| Commit dot | Click | (Future) navigate to slice detail; currently no action |
| Merge to main button | Click | Emit `gate-start` event; progress widget appears |
| Abort button (during gate) | Click | Emit `gate-abort` event; widget closes; state reverts |
| RR dial | Hover | Tooltip shows RR percentage, zone (low/mid/high), formula breakdown |

### Active Build panel (Rom lane)

| Control | Action | Expected behavior |
|---------|--------|-------------------|
| "View live log" button | Click | Open modal with streaming log output |
| Close button on log modal | Click | Modal closes |
| "Stop build" button | Click | Send SIGTERM or SIGKILL to Rom's process; slice transitions to DONE or escalates |
| Idle state hint pill | View only | Shows "Standing by" or wait estimate; no interaction |

### Post-Build Pipeline panel (Nog lane)

| Control | Action | Expected behavior |
|---------|--------|-------------------|
| Lane-card (during Nog review) | Click | (Future) drill down to slice detail; currently view-only |

### Queue panel

| Control | Action | Expected behavior |
|---------|--------|-------------------|
| Staged group header | View only | Shows "Staged" label and help text |
| Approved-queue group header | View only | Shows "Approved queue" label and help text; sometimes shows "Poll every 30s" countdown ring |
| Queue row (staged) | Click (except handle/buttons) | Toggle `.expanded` state; chevron rotates; detail block slides open |
| Queue row (approved) | Click (except handle/buttons) | Same as staged |
| Drag handle (6-dot grid, approved rows only) | Grab and drag | Begin drag operation; row opacity becomes 0.6; drop target shows dashed border; cursor changes to `grabbing` |
| Drag handle release | Release mouse | Row snaps to final position; new order persists to `queue-order.json` |
| Approve button (staged rows) | Click | Move row from staged → queue; emit `HUMAN_APPROVAL` event; animate transition |
| Edit button | Click | Open slice editor (external tool or in-page modal) |
| Reject button (✕, staged rows) | Click | Show inline confirm dialog ("Reject?", two buttons) |
| Confirm reject | Click | Archive slice; remove row with fade-out animation; emit event |
| Cancel reject | Click | Close dialog; row remains |
| Row expand chevron | Click | Toggle `.expanded` state |
| Detail tabs (in expanded body) | Click | Switch active tab; fetch/display content |

### History panel

| Control | Action | Expected behavior |
|---------|--------|-------------------|
| History row | Click (except tabs/buttons) | Toggle `.expanded` state; chevron rotates; detail block reveals |
| Expand chevron | Click | Same as row click |
| Detail tabs | Click | Switch active tab |
| "Open in editor" button | Click | Open slice file in editor |
| Archive link (footer) | Click | (Future) navigate to full archive view |

### Universal

| Control | Action | Expected behavior |
|---------|--------|-------------------|
| Any `.btn` | Hover | Background transitions to `--bg-hover`; opacity changes (120ms ease) |
| Any `.btn` | Focus (keyboard) | Outline appears (2px solid, color varies by variant) |
| Any `.btn` | Click (active state) | Translate down 1px; 80ms fast animation |
| Any `.btn` (disabled) | Hover | No state change; cursor is `not-allowed` |
| Page body | Scroll | Panels scroll independently; no scroll lock |
| Keyboard: `Tab` / `Shift+Tab` | Focus navigation | Follow focus-order defined in Ops spec (header → topology → build → pipeline → queue → history) |
| Keyboard: `Escape` | Close modals/expanded rows | Dismiss any open modal; collapse expanded row |
| Keyboard: `Enter` on row | Toggle expanded | Same as click on row |

## Known failure modes and edge cases

- **Button disabled state not visually obvious.** The spec says `cursor: not-allowed` and greyed text, but users may not realize it's not clickable. *Recommendation:* Add a tooltip on hover: "Cannot approve while gate is running."
- **Drag handle is hard to grab on touch devices.** The 6-dot grid may be too small. *Recommendation:* Expand touch target; consider an explicit drag icon.
- **Rows expand/collapse too quickly, confusing users.** The chevron rotation (150ms) may need to match the slide animation. *Recommendation:* Ensure chevron and detail-reveal are in sync visually.
- **Tabs have no indication of which tab is active.** The spec says "text gains weight 600 + bottom border `--ink`" but may not be visible if contrast is low. *Recommendation:* Test contrast ratios.

## Sources

- `repo/.claude/roles/obrien/inbox/HANDOFF-OPS-REDESIGN-SPEC-FROM-ZIYAL.md` — full spec with interactions and states
- `dashboard/server.js` (or index.html) — implementation of buttons and event handlers
- `bridge/events.jsonl` — event contract for UI-emitted events

## Open questions

- Are there any keyboard shortcuts (e.g., Ctrl+M for "Merge to main")? The spec lists Tab, Escape, Enter/Space for row expand, but doesn't mention others.
- Can users filter or search the Queue panel (e.g., filter by slice ID or status)? Not mentioned in spec.
- Is there a "pause dispatch" button (equivalent to `.pipeline-paused` flag)? The spec mentions the flag but not a UI control to set it.
- Can the RR dial be clicked to show more detail, or is it view-only (tooltip on hover only)?
