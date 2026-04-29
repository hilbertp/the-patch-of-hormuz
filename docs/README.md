# Documentation taxonomy

This directory holds project documentation organized by purpose. Authors should use the taxonomy below when creating new docs.

## Folder layout

| Folder | Purpose | Authoring |
|---|---|---|
| `architecture/` | System architecture documents and ADRs (Architecture Decision Records). Long-lived; describe how the system is built and why. | Dax, with role contributions |
| `adr/` | Numbered ADRs (legacy single-doc location). New ADRs go in `architecture/` with `-ADR` suffix. | Dax |
| `contracts/` | Interface contracts between components — slice format, lifecycle states, done-report format, etc. Authoritative source for cross-role agreements. | Dax + the contract owners |
| `runbooks/` | Operational procedures: what to do when X breaks. 3am-readable. Owned by Worf for ops surfaces; by component owner for component-specific recovery. | Worf primarily |
| `obrien/` | O'Brien's working docs — keeper list, failure reports, sprint briefs, recovery plans. Personal-namespace working area, not authoritative reference. | O'Brien |
| `kira/` | Kira's working docs — slicing examples, evaluation rubrics, watcher tasks. | Kira |
| `ziyal/` | Ziyal's design briefs and discovery work. | Ziyal |

## Where to put new docs

- **Decision being made about how the system should work:** `architecture/` as `*-ADR.md`.
- **Cross-role interface specification:** `contracts/`.
- **Operational procedure (something operators run when things break):** `runbooks/`.
- **Working notes from a single role:** that role's folder.
- **Top-level overview consumed by all roles:** root of `docs/`.

If unsure: ask the relevant role owner before creating, not after.
