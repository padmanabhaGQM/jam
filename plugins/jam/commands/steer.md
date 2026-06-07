---
description: Record a durable steering directive — re-injected and re-checked at every later gate
argument-hint: "\"<your redirection, with the correct context>\""
allowed-tools: Bash(node:*)
---

Record a durable steering directive via the jam CLI; report output verbatim:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/jam.mjs" steer "$ARGUMENTS"
```
