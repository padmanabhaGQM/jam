---
description: Rehydrate a jam run after a restart or compaction
argument-hint: "<run-id>"
allowed-tools: Bash(node:*), Read
---

> **Scaffold — not yet implemented.** See design spec §9.

Rehydrate run `$ARGUMENTS` from disk: load `state.json` (phase, gates, coverage, directives, Codex session ids) and report where it stands so work continues exactly where it left off. Global context lives on disk, not in the model's memory.
