---
description: Diagnose jam setup problems on this machine
argument-hint: ""
allowed-tools: Bash(node:*)
---

Run `jam doctor`.

Doctor checks Node >=18.18, git, the Codex CLI binary, Codex auth on a best-effort basis, that the project is a git repo with a commit, and version coherence between the plugin and package metadata.

It prints a fix for each failing check. Run it first on any new machine and whenever `codex-run` misbehaves.
