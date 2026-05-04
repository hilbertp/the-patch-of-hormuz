Audit this codebase and produce a complete catalog of every event emitted to bridge/register.jsonl.

For each unique event name:
- The event name (string)
- Which file:line emits it (cite all emission sites if multiple)
- The trigger condition in plain English (one sentence)
- The shape of the payload fields beyond `event` and `slice_id` / `ts`

Write the catalog as a markdown table sorted alphabetically by event name. Save it to `experiments/rag-ab/run-2/output-{base|ruflo}.md` (replace {base|ruflo} with the run identifier passed by the runner script).

Search broadly. Events are emitted from `bridge/orchestrator.js`, `bridge/git-finalizer.js`, `bridge/state/*.js`, and possibly other files. Look at every callsite of `registerEvent`, `register.append`, and any direct writes to `register.jsonl`. Do not miss any.

Stop when the catalog is written. Report the total event-name count and which files you scanned.
