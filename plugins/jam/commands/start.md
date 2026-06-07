---
description: Start a new jam run — begins the ALIGN phase (vision + architecture)
argument-hint: "<topic or short description of what to build>"
allowed-tools: Bash(node:*), Read, Write, AskUserQuestion, Skill, Agent
---

Run the jam CLI to start a run for: `$ARGUMENTS`

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/jam.mjs" start "$ARGUMENTS"
```

Report the CLI output verbatim. This creates the run and its ALIGN gate (pending). Live ALIGN orchestration is not wired yet (Slice 2b) — for now you drive the run with `/jam:status`, `/jam:approve`, `/jam:steer`, `/jam:cancel`.
