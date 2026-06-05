---
description: Reject a gate — sends the work back instead of advancing
argument-hint: "<gate-id> [reason]"
allowed-tools: Bash(node:*)
---

> **Scaffold — not yet implemented.** See design spec §5, §8.

Reject gate `$ARGUMENTS`. Records the rejection + reason in `state.json` and the ledger, and holds the loop until the work is revised. Often paired with `/jam:steer` to say what to fix.
