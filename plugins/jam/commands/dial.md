---
description: Adjust how strict a gate is (human | show-and-proceed | auto)
argument-hint: "<gate-id> <human|show-and-proceed|auto>"
allowed-tools: Bash(node:*)
---

> **Scaffold — not yet implemented.** See design spec §8.

Set the mode for gate `$ARGUMENTS`. Defaults are distrust-heavy (ALIGN/PLAN/sprint-review = `human`; evidence = `auto`). Loosen specific gates as trust in the *structure* grows — never as trust in the models grows. Recorded in `state.json` + ledger.
