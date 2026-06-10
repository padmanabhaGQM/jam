# jam — an honest, controlled Claude–Codex build loop

**jam** pairs **Claude** (the brain) and **Codex** (the hands) into a single, supervised
repair/hardening loop for Claude Code — **without surrendering your control.**

- **Claude is the brain** — diagnose, plan, write the prompts that drive Codex, review.
- **Codex is the hands** — implements and returns exact evidence (via the official [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)).
- **You are the supervisor** — you validate trajectory at gates and steer.

Governing principle: **trust the structure, not the model** (including not trusting Claude, the orchestrator). Every control is enforced by deterministic plugin machinery — on-disk state, mechanism-bound gates, an immutable ledger, a run-honesty audit — that the models cannot talk past.

> **Status — pre-alpha.** The control surface is built and unit-tested (316 tests), and the full `DIAGNOSE → VERIFY → PLAN → IMPLEMENT → FINISH` loop has been **driven end-to-end with real Codex** on a controlled repo (real bug, real `verify.sh`; Codex grounded the diagnosis and implemented the fix; the global gate, role-binding, and honesty audit all held to FINISH). **Not yet proven:** a hard repair under live human gate-supervision, and the VERIFY adversarial-review turn against real Codex. Treat jam as rigorously built but not battle-tested. See [CHANGELOG.md](CHANGELOG.md).

**Two modes.** jam runs in **repair** mode (`jam diagnose` — fix/harden an existing repo through `DIAGNOSE→VERIFY→PLAN→IMPLEMENT→FINISH`) or **greenfield** mode (`jam start --mode greenfield` — build from a raw intent, starting with a `GROUND` phase that produces an evidence-backed, human-ratified grounded-intent). The `CONVERGE` phase then converges Claude+Codex on one evidence-backed architecture decision (human-ratified). `SPECIFY` then authors the project's global `verifyCmd` as a human-ratified, un-gameable SSOT (red-first + dimension-coverage + a Codex gameability audit). Finally `BUILD` runs the gated sprint loop against that locked verifyCmd to `FINISH` — the same machinery repair mode uses. The full `intent → GROUND → CONVERGE → SPECIFY → BUILD → FINISH` greenfield loop is complete.

## What it enforces

| Control | Guarantee |
|---|---|
| **Mechanism-bound gates** | A gate can only be satisfied by its own mechanism (a digest can't pass a verify gate; a plan can't pass a diagnosis gate). |
| **Global `verifyCmd` gate** | A sprint can't be `done` unless the **whole project's acceptance command** exits 0 — local green is never enough. |
| **Role-binding** | A sprint can't be `done` without a **real Codex session + a locatable transcript** — Claude can't silently be the hands. |
| **Run-honesty audit** | Before FINISH, the ledger is re-proven: phase ordering, Codex authorship, evidence, scope provenance, and DAG order. A forged/inconsistent run is refused. |
| **Promotion governance** | Scope can't expand silently — every sprint is `planned` (approved) or `promoted` (a recorded decision). |
| **Sprint dependency DAG** | `needs:[ids]`, acyclic, deps-done-before-start, order audited. |
| **Hard-block tier** | Every consequential action is classified by reversibility; irreversible ones (`delete`, force-push, `DROP`, infra-destroy, deploy, restart-rearchitect) are structurally blocked behind a **typed `jam ratify <id> --confirm <id>`** — **agent consensus can never authorize a catastrophe.** (In-turn Codex shell is the deferred G0.5 layer.) |
| **Owned Codex engine** | Drives real Codex over `codex exec`; **never kills** a process (timeouts surface and stay resumable); live-thread reconciliation after pauses. |
| **Supervision surface** | 4-detector digests (architecture trace, decision register, global map, coverage) + durable steering directives, rendered at gates. |

## Requirements

- **Node.js ≥ 18.18**
- **Codex CLI** installed and authenticated
- **[`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)** installed + set up (`/codex:setup`) — jam composes it for adversarial review
- A **git-trusted** target project (evidence/diffs assume a VCS)

## Install

In Claude Code:

```text
# 1. the official Codex plugin (the hands)
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/codex:setup

# 2. jam (the harness)
/plugin marketplace add padmanabhaGQM/jam
/plugin install jam@neel-plugins
```

Restart Claude Code to load it. Installed at user level, jam is available in **every** project — but a run only starts when you ask.

## How you use it

Two layers:

1. **The UX — slash commands + the orchestrator skill.** In any project, ask Claude to *"diagnose and fix `<repo>` toward `<goal>` with jam"*. The `jam-orchestrator` skill drives the loop; you approve at gates with `/jam:approve <gate>` and redirect with `/jam:steer "<text>"`.
2. **The mechanism — the `jam` CLI** (run under the hood by the skill as `node "${CLAUDE_PLUGIN_ROOT}/scripts/jam.mjs" <subcommand>`; also runnable by hand from a clone). The `jam <subcommand>` forms shown below are that CLI.

### Slash commands

| Command | Purpose |
|---|---|
| `/jam:start <topic>` | Begin a run |
| `/jam:status [run-id]` | Phase, gates, sprints, provenance, directives |
| `/jam:approve <gate>` | Record your sign-off |
| `/jam:reject <gate>` | Reject a gate |
| `/jam:steer "<text>"` | Record a durable steering directive |
| `/jam:rewind <phase\|gate>` | Roll back |
| `/jam:dial <gate> <mode>` | Adjust gate strictness |
| `/jam:resume <run-id>` | Rehydrate a run |
| `/jam:cancel` | Cancel the run |

## The repair loop (what the orchestrator runs)

```bash
# DIAGNOSE — Claude root-causes + a real Codex grounding turn → 4-detector digest
jam diagnose "fix the global story spine" --goal goal.md
jam render-digest DIAGNOSE --file diag.json   # → /jam:approve DIAGNOSE → jam advance → VERIFY

# VERIFY — Codex /codex:adversarial-review REFUTES the diagnosis vs the source
jam verify --file verdict.json                # verified only if no blockers survive → approve → advance → PLAN

# PLAN — decompose into sprints; verifyCmd is the WHOLE acceptance bar (validators + reviewer scores + lint + types)
#   plan.json: { "verifyCmd": "bash verify.sh", "sprints": [ {"id":"fix-1","title":"…","acceptanceCriteria":"…","needs":[]} ] }
jam plan --file plan.json                     # → approve → advance → IMPLEMENT

# IMPLEMENT — per sprint, in dependency order (jam status shows ready/blocked)
jam sprint fix-1 --start
jam codex-run --sprint fix-1 --prompt-file p.md --timeout 600000 --out-dir .jam/codex/fix-1   # Codex implements; binds the session
jam sprint fix-1 --verify                     # runs the GLOBAL verifyCmd; passes only on exit 0
jam sprint fix-1 --done                       # refuses unless verified AND Codex-authored
# discovered scope? jam promote-sprint fix-9 --title "…" --reason "why" --needs fix-1

jam audit                                     # run-honesty audit (also enforced at FINISH)
jam advance                                   # → FINISH when all sprints done AND the audit passes
```

### Owned Codex engine (never-kill, recoverable)

```bash
jam codex-run --prompt-file prompt.md --timeout 600000 --out-dir .jam/codex/step
# prints: status: completed|timed_out + session id + out-dir. A timed_out Codex process is NEVER killed — resume it:
jam codex-resume <sessionId> --prompt-file reply.md --out-dir .jam/codex/step
jam codex-status --event-log .jam/codex/step/events.jsonl
```

## Best practice (for production-grade hardening)

1. **Make `verifyCmd` the *whole* acceptance bar** — validators + reviewer/quality scores + lint + types, not just unit tests. This is what ends locally-correct-globally-broken loops.
2. **Let Codex be the hands** — implement *through* `jam codex-run --sprint`; the role-binding gate enforces it and keeps the audit trail honest.
3. **Decompose into a DAG** with `needs`, so sprints unlock in order and the audit proves it.
4. **Promote discovered scope**, never sneak it.
5. **Supervise at the digests**, not the diff lines — that's where drift shows.

jam covers the *hardening* middle of the lifecycle. Pair it with brainstorming/planning up front and your CI/CD at the end — jam's output is a verified, audited, acceptance-passing branch; deployment is downstream.

## Honest limitations

- jam is a **repair/hardening** loop, not a greenfield architect and **not a deployer**.
- It has **never driven a hard repair under live human supervision** — the proven run was a one-line fix with gates self-approved in test mode.
- The VERIFY adversarial-review integration is exercised by design/prose; it has not been run against real Codex end-to-end.
- The acceptance bar is only as good as your `verifyCmd`.

## Develop / contribute

```bash
git clone https://github.com/padmanabhaGQM/jam && cd jam
npm test          # 316 tests, no dependencies (node --test)
# drive the CLI by hand from the clone:
node plugins/jam/scripts/jam.mjs status
```

No runtime dependencies (Node ESM + `node:test`). Issues and PRs welcome.

## License

[Apache-2.0](LICENSE) © 2026 Padmanabha Banerjee (Neel). See [NOTICE](NOTICE).
