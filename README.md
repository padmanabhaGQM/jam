# jam — an honest, controlled Claude–Codex build loop

`jam` automates the Claude↔Codex pairing for production work **without surrendering your control.**

- **Claude is the brain** — research, architecture, plans, the structured prompts that drive Codex, and review.
- **Codex is the hands** — implements and returns exact evidence (via the official [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)).
- **You are the supervisor** — you validate trajectory at intermediate states and steer.

The governing principle is **trust the structure, not the model** (including not trusting Claude, the orchestrator). Every control is enforced by deterministic plugin machinery — hooks, on-disk state, evidence scripts, schemas — that the models cannot talk past.

> **Status: pre-alpha (orchestrated diagnosis).** jam can run a repair-mode DIAGNOSE→VERIFY loop: it orchestrates Claude (systematic-debugging) + Codex (independent grounding + adversarial refutation) and refuses to release a diagnosis to planning until an adversarial pass fails to break it. PLAN→IMPLEMENT + verify.sh are next.

## What it does (when built)

A staged loop with a two-halved control surface:

- **Enforcement (the stops):** un-forgeable gates, evidence-not-claims, no-author-grades-own-work, an immutable ledger, a kill switch + runaway guard.
- **Legibility (the supervision):** at intermediate states it renders a glanceable digest (summary + flow + guide) exposing four drift-detectors — trace-to-architecture, design-decision register, global project map, spec/plan coverage — before it proceeds.
- **Steering:** you type a redirection; it becomes a durable directive that is re-injected and re-checked at every later gate.

## Requirements

- Node.js >= 18.18
- [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) installed and set up (`/codex:setup`)
- Codex CLI installed and authenticated
- A git-trusted target project (evidence/diffs assume a VCS)

## Install (user-level, always available)

```bash
# 1. the official Codex plugin (the hands)
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/codex:setup

# 2. jam (the harness) — from this repo
/plugin marketplace add <path-or-git-url-to-this-repo>
/plugin install jam@neel-plugins
```

Once installed at user level, the pairing is available in **every** project. A run still only starts when you ask:

## Commands

| Command | Purpose |
|---|---|
| `/jam:start <topic>` | Begin a run (ALIGN phase) |
| `/jam:status [run-id]` | Phase, gates, coverage, active directives |
| `/jam:approve <gate>` | Record your sign-off (writes state) |
| `/jam:reject <gate>` | Reject a gate |
| `/jam:steer "<text>"` | Record a durable steering directive |
| `/jam:rewind <phase\|gate>` | Roll back to a prior point |
| `/jam:dial <gate> <mode>` | Adjust how strict a gate is |
| `/jam:resume <run-id>` | Rehydrate a run |
| `/jam:cancel` | Kill the run |

## Repair mode (diagnose an existing pipeline)

```bash
jam diagnose "fix the global story spine" --goal goal.md
# orchestrator: systematic-debugging (Claude) + /codex:rescue (Codex) → 4-detector digest
jam render-digest DIAGNOSE --file diag.json && jam approve DIAGNOSE && jam advance   # → VERIFY
# orchestrator: verification-before-completion + /codex:adversarial-review (refute vs source)
jam verify --file verdict.json   # verified only if no blockers survive
jam approve VERIFY && jam advance   # → PLAN (2b-2)
```

## Drive a run by hand (no LLM yet)

```bash
cd <your project>
node ~/neel-workspace/jam/plugins/jam/scripts/jam.mjs start "try jam"
node ~/neel-workspace/jam/plugins/jam/scripts/jam.mjs status
# write a digest JSON with the four detectors to digest.json, then:
node ~/neel-workspace/jam/plugins/jam/scripts/jam.mjs render-digest ALIGN --file digest.json
node ~/neel-workspace/jam/plugins/jam/scripts/jam.mjs approve ALIGN
node ~/neel-workspace/jam/plugins/jam/scripts/jam.mjs add-gate sprint-0 --mode auto
node ~/neel-workspace/jam/plugins/jam/scripts/jam.mjs evidence sprint-0 --sprint s0 --cmd "npm test"
node ~/neel-workspace/jam/plugins/jam/scripts/jam.mjs status
```

## Design

See the design spec: `docs/superpowers/specs/2026-06-05-claude-codex-loop-harness-design.md` (in the workspace where this was brainstormed).

## License

TODO — choose a license before publishing.
