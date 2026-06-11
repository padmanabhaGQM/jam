---
description: Rehydrate a jam run after a restart or compaction
argument-hint: ""
allowed-tools: Bash(node:*)
---

Run `jam resume`.

Resume is read-only. It prints the run status plus exactly one next action: reconcile an open turn, verify, mark a sprint done, approve a gate, produce the missing artifact, or advance the phase.

Use it after restarting Claude Code, returning to a machine, or recovering after compaction. Global context lives on disk, not in the model's memory.
