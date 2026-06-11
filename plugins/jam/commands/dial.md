---
description: Adjust how strict a gate is
argument-hint: "<gateId> --mode <human|show-and-proceed> [--confirm <gateId>]"
allowed-tools: Bash(node:*)
---

Run `jam dial <gateId> --mode <human|show-and-proceed> [--confirm <gateId>]`.

Tightening a gate to `human` is free. Loosening to `show-and-proceed` requires the typed confirm because it delegates a human stop into a recorded, auditable proceed signal.

Ratification gates for irreversible actions and sprint evidence gates are never dialable. Nothing can be dialed to `auto`; automatic passage is earned only by the gate's evidence mechanism.

Loosen as trust in the structure grows, never as trust in the models grows. Every dial change is recorded in state and the ledger.
