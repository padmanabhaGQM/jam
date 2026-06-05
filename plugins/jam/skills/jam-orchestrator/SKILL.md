---
name: jam-orchestrator
description: Use to run a jam build loop — the phase state machine that drives Claude (brain) and Codex (hands) through ALIGN → PLAN → SPRINT → FINISH, owning gates, evidence, ledger, digests, and steering. Invoked by /jam:start.
---

> **Scaffold — not yet implemented.** This file defines the contract; the logic is built next (see design spec).

# jam orchestrator

You drive the asymmetric Claude–Codex loop. **Claude is the brain** (architecture, plans, the structured Codex prompts, review); **Codex is the hands** (implements via `/codex:rescue`, returns evidence; challenges via `/codex:adversarial-review`). **The user supervises.**

## Non-negotiables (trust the structure, not the model)
- Never mark a gate passed by asserting it. Advancement happens only through plugin commands that write `state.json`; the `Stop` gate hook enforces it.
- Evidence over claims: a sprint is not done until the plugin's own verification re-run exits 0 (`lib/evidence.mjs`).
- No author grades its own work: the gate-closing verdict comes from a non-author (`schemas/verdict.schema.json`).
- Before any gate, render a conforming digest exposing all four drift-detectors (`skills/jam-digest`).
- Re-inject and re-check active steering directives at every later gate.
- Everything material is appended to the ledger by the plugin, not narrated by you.

## Phases
See design spec §4. ALIGN (brainstorming + adversarial-review) → PLAN (writing-plans + adversarial-review) → SPRINT loop (prompt → build → evidence → review×2 → digest → gate → steer) → FINISH.
