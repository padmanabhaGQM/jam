---
description: Show the current jam run — phase, gates, coverage, active steering directives
argument-hint: "[run-id]"
allowed-tools: Bash(node:*), Read
---

> **Scaffold — not yet implemented.** See design spec §9.

Report the state of run `$ARGUMENTS` (or the active run): current phase/sprint, each gate's mode and status, spec/plan coverage (addressed vs dropped), and active steering directives. Read-only — reads `state.json` and the ledger; never advances anything.
