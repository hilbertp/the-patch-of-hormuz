You have access to the `claude-flow` MCP server. It exposes 200+ tools across memory, swarm, task, agent, and analysis namespaces.

Your task is to produce a one-page summary of this codebase's slice lifecycle by USING THE CLAUDE-FLOW TOOLS. Specifically:

1. Use a claude-flow memory tool (e.g., `mcp__claude-flow__memory_usage` with action `store`) to save these three pieces of evidence:
   - The name and purpose of every state file in bridge/state/ (read each file's header)
   - The lifecycle states from the slice queue (STAGED, IN_PROGRESS, etc., per docs/contracts/slice-lifecycle.md if present)
   - The list of events emitted to register.jsonl (top 10 most frequent)

2. Use a claude-flow analysis tool (e.g., `mcp__claude-flow__performance_report`) on the data you stored.

3. Use a claude-flow task tool (e.g., `mcp__claude-flow__task_orchestrate`) to decompose "produce the lifecycle summary" into subtasks.

4. Then write the actual summary to `experiments/rag-ab/run-3/output.md` — one page, plain markdown, no fluff.

For every claude-flow tool call you make, report:
- Tool name
- Arguments passed
- Whether it succeeded
- Brief description of return value

Failure mode: if a claude-flow tool errors or doesn't exist with that exact name, fall back to the closest equivalent in the same namespace and document the substitution. If the namespace is empty, report that as data.

Stop when output.md is written and the tool-call log is reported.
