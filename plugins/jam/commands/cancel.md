---
description: Kill the active jam run (and any running Codex job)
argument-hint: "[run-id]"
allowed-tools: Bash(node:*)
---

Cancel the active jam run via the jam CLI; report output verbatim:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/jam.mjs" cancel
```
