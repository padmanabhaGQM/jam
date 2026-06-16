---
description: Promote discovered implementation scope into an explicit sprint
argument-hint: "<id> --title <t> --reason <r> [--acceptance <a>] [--discovered-by <d>] [--allow <comma-globs>]"
allowed-tools: Bash(node:*), Read
---

Promote discovered scope through the jam CLI and report the output verbatim:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/jam.mjs" promote-sprint $ARGUMENTS
```

Use `--allow` to scope-lock the promoted sprint:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/jam.mjs" promote-sprint fix-extra \
  --title "fix extra bounded scope" \
  --reason "discovered during implementation" \
  --allow "src/fix.js,tests/fix.test.mjs"
```

`--allow` is comma-separated and records `allowedPaths` on the sprint. During reconcile, jam keeps matching paths and strips out-of-scope edits with a loud ledger entry.
