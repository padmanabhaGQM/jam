---
description: Kill the active jam run (and any running Codex job)
argument-hint: "[run-id]"
allowed-tools: Bash(node:*)
---

> **Scaffold — not yet implemented.** See design spec §5.

Halt run `$ARGUMENTS` (or the active run): mark it cancelled in `state.json` + ledger and cancel any in-flight Codex job via `/codex:cancel`. The kill switch — always available.
