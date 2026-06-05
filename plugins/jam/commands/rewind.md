---
description: Roll the run back to a prior phase or gate
argument-hint: "<phase|gate-id>"
allowed-tools: Bash(node:*)
---

> **Scaffold — not yet implemented.** See design spec §5.

Rewind the run to `$ARGUMENTS`. Resets gate statuses at/after that point to `pending`, preserves the ledger (rewinds are recorded, not erased), and re-enters from there. Use when trajectory went wrong and a redirection isn't enough.
