---
id: "121"
title: "Fix(new-slice): split references into depends_on and amendment fields"
from: rom
to: nog
status: DONE
slice_id: "121"
branch: "slice/121"
completed: "2026-04-16T01:23:30.000Z"
tokens_in: 28000
tokens_out: 3500
elapsed_ms: 120000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

Split the dual-meaning `references` field into two distinct fields:

- **`depends_on`** — informational comma-separated IDs for dependency tracking. The watcher ignores this field for branch logic.
- **`amendment`** — explicit branch name to reuse. When set, the watcher checks out that branch instead of creating a new one.

## Changes

### `bridge/new-slice.js`
- Replaced `--references` flag with `--depends-on` and `--amendment` flags
- Updated `buildFrontmatter()` to emit `depends_on` and/or `amendment` instead of `references`
- Updated usage/help text

### `bridge/watcher.js`
- **Line 1320**: Amendment detection now checks `sliceMeta.amendment` first, with fallback to legacy `sliceMeta.references` for backward compat
- **Line 1321-1323**: Branch derivation uses `sliceMeta.amendment` directly as the branch name (exact match, not ID-based)
- **Line 2360**: Auto-generated amendment slices now emit `amendment: "{branchName}"` instead of `references: "{id}"`
- **Lines 2606, 2613**: Priority sorting also checks `meta.amendment` alongside legacy `meta.references`

## Backward compatibility

Legacy `references` field in existing PENDING files still triggers amendment behavior. All checks use `sliceMeta.amendment || sliceMeta.references` pattern.

## Verification

- `node bridge/new-slice.js --depends-on "117"` creates a slice with `depends_on: "117"` and no `references` or `amendment`
- `node bridge/new-slice.js --amendment "slice/117-fix-title"` creates a slice with `amendment: "slice/117-fix-title"` and no `references`
- Watcher amendment detection, branch derivation, and priority sorting all updated with backward compat
