---
description: Record a durable steering directive — re-injected and re-checked at every later gate
argument-hint: "\"<your redirection, with the correct context>\""
allowed-tools: Bash(node:*)
---

> **Scaffold — not yet implemented.** See design spec §7.

Capture `$ARGUMENTS` as a durable, tracked steering directive (a spec amendment), not a chat comment. It is stored `active` in `state.json`, re-injected with context into subsequent Codex prompts and Claude reviews, and re-checked at every later gate — so an agent can't acknowledge it and quietly keep drifting. It is not marked `satisfied` until a check confirms adherence.
