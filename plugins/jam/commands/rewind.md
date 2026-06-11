---
description: Move a run back to an earlier phase
argument-hint: "<phase> --confirm <phase>"
allowed-tools: Bash(node:*)
---

Run `jam rewind <phase> --confirm <phase>`.

Rewind moves the run backward. It re-arms all gates of the target and later phases, and it requires typed confirmation because prior approvals for that portion of the run are invalidated.

History is preserved in the ledger; rewinds are recorded, not erased. The audit requires post-rewind artifacts for any re-advance.

Rewind does not touch the working tree. Code rollback is git's job.
