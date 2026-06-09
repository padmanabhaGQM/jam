# jam — an honest, controlled Claude–Codex build loop

`jam` automates the Claude↔Codex pairing for production work **without surrendering your control.**

- **Claude is the brain** — research, architecture, plans, the structured prompts that drive Codex, and review.
- **Codex is the hands** — implements and returns exact evidence (via the official [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)).
- **You are the supervisor** — you validate trajectory at intermediate states and steer.

The governing principle is **trust the structure, not the model** (including not trusting Claude, the orchestrator). Every control is enforced by deterministic plugin machinery — hooks, on-disk state, evidence scripts, schemas — that the models cannot talk past.

> **Status: pre-alpha (full gated repair loop: diagnose → verify → plan → implement → finish).** jam runs the whole repair loop over its own recoverable Codex engine; each implementation sprint is gated by the project's global `verifyCmd` — no sprint completes until the whole acceptance gate passes. Real-codex live smoke + a real `verify.sh` are the remaining validation step before production use.

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

## Codex engine (owned, recoverable)

```bash
jam codex-run --prompt-file prompt.md --timeout 600000 --out-dir .jam/codex/diagnose
# status: completed|timed_out + session id + out-dir; a timed_out Codex process is NEVER killed — resume it:
jam codex-resume <sessionId> --prompt-file reply.md --out-dir .jam/codex/diagnose
jam codex-status --event-log .jam/codex/diagnose/events.jsonl
```

## Repair mode (diagnose an existing pipeline)

```bash
jam diagnose "fix the global story spine" --goal goal.md
# orchestrator: systematic-debugging (Claude) + jam codex-run (Codex grounding) → 4-detector digest
jam render-digest DIAGNOSE --file diag.json && jam approve DIAGNOSE && jam advance   # → VERIFY
# orchestrator: verification-before-completion + /codex:adversarial-review (refute vs source)
jam verify --file verdict.json   # verified only if no blockers survive
jam approve VERIFY && jam advance   # → PLAN
```

## Plan phase

```bash
jam advance                       # VERIFY → PLAN (after approve VERIFY)
# author plan.json: { "verifyCmd": "bash verify.sh", "sprints": [ {"id":"fix-1","title":"...","acceptanceCriteria":"..."} ] }
jam plan --file plan.json         # validates + gates; the PLAN gate accepts ONLY a valid plan (not a digest/verdict)
jam approve PLAN && jam advance    # → IMPLEMENT
```

## Implement phase

```bash
# at IMPLEMENT, per sprint:
jam sprint fix-1 --start
# orchestrator: codex-run (write-capable) implements the sprint via the engine
jam sprint fix-1 --verify     # jam runs the GLOBAL verifyCmd; passes only on exit 0
jam sprint fix-1 --done       # refuses unless verified — the human go/no-go
jam advance                    # → FINISH when ALL sprints are done
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
