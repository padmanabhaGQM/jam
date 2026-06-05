---
name: jam-digest
description: Use to produce a jam intermediate-state digest — the glanceable supervision artifact (summary + flow + guide) that must expose all four drift-detectors before a gate can advance.
---

> **Scaffold — not yet implemented.** Contract only; logic built next.

# jam digest

Render a digest the user can validate at a glance, conforming to `schemas/digest.schema.json`. It MUST contain all four drift-detectors (design spec §6):

1. **Trace to architecture** — which components this step touches; any gap from what was agreed.
2. **Decision register** — design choices made this step (chosen vs alternatives vs why), surfaced before they're buried in code, for the user's taste-veto.
3. **Global project map** — a Mermaid map of the whole with current position; flag if the change looks like a local hack (anti-spiral).
4. **Spec/plan coverage** — pointers addressed vs dropped this step.

Keep it cheap to produce and fast to read. Default render: Markdown + Mermaid in terminal; browser Visual Companion optional for heavier visuals.
