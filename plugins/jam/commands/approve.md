---
description: Record your human sign-off for a gate (the only way a human-mode gate passes)
argument-hint: "<gate-id>"
allowed-tools: Bash(node:*)
---

> **Scaffold — not yet implemented.** See design spec §5, §8.

Record approval for gate `$ARGUMENTS`. This writes the approval (who/when) into `state.json` via the deterministic helper and appends to the ledger. This is the *only* way a `human`-mode gate flips to approved — the model cannot fabricate it.
