---
description: Start a new jam run — begins the ALIGN phase (vision + architecture)
argument-hint: "<topic or short description of what to build>"
allowed-tools: Bash(node:*), Read, Write, AskUserQuestion, Skill, Agent
---

> **Scaffold — not yet implemented.** See design spec §4 (phase ALIGN) and §9.

Begin a jam run for: `$ARGUMENTS`

Intended behavior:
- Create the run dir `docs/superpowers/loop-runs/<run-id>/` and initialize `state.json`.
- Enter **ALIGN**: research-backed brainstorm with the user (reuse `superpowers:brainstorming`); challenge the architecture via `/codex:adversarial-review`.
- Produce `architecture.md` + `decisions.md`, render the ALIGN digest, and stop at the ALIGN gate (human sign-off by default).
