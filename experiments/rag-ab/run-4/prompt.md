You are working in a Node.js project at the current directory. Your task is a cross-file refactor:

**Rename `registerEvent` to `appendSliceEvent` everywhere it is called, defined, or referenced — including JavaScript source files, test files, and markdown documentation.**

Rules:
1. Rename the function definition and ALL call sites.
2. Rename references in markdown docs (e.g., backtick-quoted `registerEvent` in ADRs, role docs, findings).
3. Do NOT rename partial matches like `registerEventEmitter`, `registerEventListener`, or any identifier where `registerEvent` is a substring of a longer name.
4. Do NOT rename string literals that are event names (e.g., `'registerEvent'` used as a string key is fine to rename, but `'REGISTER_EVENT'` enum values should stay).
5. After making all changes, run `node -e "require('./bridge/orchestrator.js')"` to verify the main module loads without syntax errors.
6. Report: (a) how many files you changed, (b) how many individual replacements you made, (c) any call sites you intentionally skipped and why.

The codebase has ~214 occurrences of `registerEvent` across ~41 files. Be thorough.
