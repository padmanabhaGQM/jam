---
description: Reject a gate — sends the work back instead of advancing
argument-hint: "<gateId> --reason \"<text>\""
allowed-tools: Bash(node:*)
---

Run `jam reject <gateId> --reason "<text>"`.

Reject refuses a human gate with a recorded reason. The gate blocks until its artifact is re-produced, such as a digest, verdict, or plan, and only then can it be approved.

Approval directly over a rejection is structurally impossible. The rejection and reason are permanent ledger facts, so the later approval has to be backed by fresh work rather than a silent override.
