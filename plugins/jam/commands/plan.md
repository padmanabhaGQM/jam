---
description: Record the approved sprint plan and global verify command
argument-hint: "--file <plan.json>"
allowed-tools: Bash(node:*), Read
---

Record the approved plan through the jam CLI and report the output verbatim:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/jam.mjs" plan $ARGUMENTS
```

`plan.json` must contain `verifyCmd` and a non-empty `sprints` array. A sprint may declare `allowedPaths`, a non-empty array of path globs:

```json
{
  "verifyCmd": "npm test",
  "sprints": [
    {
      "id": "s1",
      "title": "fix bounded file",
      "acceptanceCriteria": "the global verifyCmd passes",
      "allowedPaths": ["src/fix.js"]
    }
  ]
}
```

When present, `allowedPaths` scope-locks reconcile: only matching paths from the Codex turn are applied; out-of-scope changes are stripped and recorded loudly.
