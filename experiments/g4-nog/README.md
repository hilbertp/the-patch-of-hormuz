# G4-Nog: RAG over past Nog verdicts

## Status: BLOCKED

This experiment cannot be executed as designed. Three independent blockers:

### Blocker 1: No verdict data exists

`bridge/register.jsonl` does not exist. There are no `NOG_DECISION` events
to extract. The brief assumes 50+ past verdicts are available — they are not.

Related JSONL files (`anchors.jsonl`, `timesheet.jsonl`, `sessions.jsonl`)
contain no Nog verdict data.

### Blocker 2: Ruflo vector memory is non-functional

W-Ruflo-Fix-1 through Fix-3 established that:
- The model ignores all 237 Ruflo MCP tools (0 tool calls across 4 A/B runs)
- Ruflo hooks are broken due to a packaging bug (hooks at marketplace root
  instead of per-plugin directories)
- The only measurable effect of Ruflo is increased cost (+163% in Fix-3)

Pre-loading verdicts into "Ruflo's vector memory" requires the model to
actually invoke Ruflo's retrieval tools during review. Fix-3 proved it won't.

### Blocker 3: RAG premise invalidated by prior experiments

Even if data existed and tools connected, the model has demonstrated a strong
preference for native tools (Grep, Read, Edit) over Ruflo MCP tools. There is
no evidence that adding RAG context via Ruflo would change review behavior.

## What would unblock this

1. Build `register.jsonl` with real Nog verdict history (requires running Nog
   on enough slices to accumulate 50+ decisions)
2. Fix Ruflo's hooks packaging bug upstream (`ruvnet/ruflo`)
3. Demonstrate at least one successful Ruflo tool invocation in a real workflow

All three are prerequisites. None are met.
