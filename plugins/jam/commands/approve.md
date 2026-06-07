---
description: Record your human sign-off for a gate (the only way a human-mode gate passes)
argument-hint: "<gate-id>"
allowed-tools: Bash(node:*)
---

Record your sign-off for gate `$ARGUMENTS` via the jam CLI; report output verbatim:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/jam.mjs" approve "$ARGUMENTS"
```
