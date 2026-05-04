# G5 Swarm Experiment — Task Definition

**Task:** Audit all experiment directories for consistency, then produce a unified metrics summary.

This task was chosen because it has three naturally decomposable phases:
1. **Read phase** — scan all experiments/{ruflo-probe,rag-ab,ruflo-fix-1,ruflo-fix-2,g4-nog} directories, catalog all files and their roles
2. **Write phase** — produce a consolidated metrics table across all prior experiments (V1-V4, G4)
3. **Test phase** — validate that every experiment referenced in docs/ruflo/*.md has a corresponding directory and that metrics are consistent

This maps cleanly to the swarm topology: reader gathers, writer synthesizes, tester validates.

## Why this task

- Complex enough to plausibly benefit from parallelism (5 experiment dirs, 6 findings docs, cross-referencing)
- No production code changes required
- Measurable quality: the output is either complete/correct or not
- Representative of "scan many files, synthesize, verify" work that swarms claim to accelerate
