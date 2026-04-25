# Orchestrator Refactor ADR (0001)

**ADR location:** `docs/adr/0001-orchestrator-refactor-and-watcher-deprecation.md`  
**Decided:** 2026-04-23 (slice 192)

`bridge/orchestrator.js` (4716 LOC) splits into `bridge/relay/*.js` (12 modules, each ≤600 LOC) across slices 193–195.  
`watcher.js` was already renamed to `orchestrator.js` in slice 176 — no separate file to delete.  
PARKED file eliminated via **Path A**: Rom embeds the original slice spec in the DONE report; Nog reads from DONE directly.  
Slice 193 = delete deprecated dead code (−180 LOC). Slice 194 = mechanical split into relay/ modules (pure refactor). Slice 195 = PARKED elimination (~300 LOC changed).
