---
description: Reconcile a completed isolated Codex sprint turn into the main worktree
argument-hint: "--sprint <id>"
allowed-tools: Bash(node:*), Read
---

Run reconcile through the jam CLI and report its output verbatim:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/jam.mjs" reconcile $ARGUMENTS
```

If the sprint declares `allowedPaths`, reconcile applies only matching turn paths. Out-of-scope changes are discarded from the main worktree and surfaced as:

```text
scope-stripped <n> out-of-allowlist path(s) from turn <token>: <paths>
```

The ledger records the same event as `turn-scope-stripped` with `dropped` and `kept` path lists, followed by the normal `turn-reconciled` entry when the in-scope patch lands.
