# jam — an honest, controlled Claude–Codex build loop

**jam** pairs **Claude** (the brain) and **Codex** (the hands) into a single, supervised
repair/hardening loop for Claude Code — **without surrendering your control.**

- **Claude is the brain** — diagnose, plan, write the prompts that drive Codex, review.
- **Codex is the hands** — implements and returns exact evidence (via the official [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)).
- **You are the supervisor** — you validate trajectory at gates and steer.

Governing principle: **trust the structure, not the model** (including not trusting Claude, the orchestrator). Every control is enforced by deterministic plugin machinery — on-disk state, mechanism-bound gates, an immutable ledger, a run-honesty audit — that the models cannot talk past.

> **Status — rigorously built, instrumented, not yet human-proven.** Two complete loops: **repair** (`DIAGNOSE → VERIFY → PLAN → IMPLEMENT → FINISH`) — jam has built its own slices through it since 0.13 (the checked-in run ledgers under `docs/superpowers/loop-runs/` are the receipts) — and **greenfield** (`GROUND → CONVERGE → SPECIFY → BUILD → FINISH`) — complete and tested end-to-end, not yet driven on a real external project. jam's build process includes an adversarial VERIFY stage (driven, as a matter of process, through Codex review turns — the ledger records the rounds and blocker counts, not the reviewer's identity); since 0.18 every round is a **ledger fact** you can audit yourself — the 0.19 slice recorded **17 verification rounds to zero blockers** (`jam report production-p1`). Today's mechanisms (0.16+): every sprint carries a **content-bound Codex session transcript** (file↔session identity — the strongest authorship signal a file anchor gives) and is gated by the project's global acceptance command, re-run **live** at FINISH; on git-backed projects each Codex turn runs **isolated in a disposable worktree** (0.17+; non-git projects fall back to in-place editing, loudly). Earlier runs predate the mechanisms that now gate them — the audit reports them against today's stricter bar (`jam report --all`). **The one claim still unproven: a run under live human gate-supervision.** [QUICKSTART.md](QUICKSTART.md) is the script for exactly that run. 419 tests, no dependencies. See [CHANGELOG.md](CHANGELOG.md).

**Two modes.** jam runs in **repair** mode (`jam diagnose` — fix/harden an existing repo through `DIAGNOSE→VERIFY→PLAN→IMPLEMENT→FINISH`) or **greenfield** mode (`jam start --mode greenfield` — build from a raw intent, starting with a `GROUND` phase that produces an evidence-backed, human-ratified grounded-intent). The `CONVERGE` phase then converges Claude+Codex on one evidence-backed architecture decision (human-ratified). `SPECIFY` then authors the project's global `verifyCmd` as a human-ratified, un-gameable SSOT (red-first + dimension-coverage + a Codex gameability audit). Finally `BUILD` runs the gated sprint loop against that locked verifyCmd to `FINISH` — the same machinery repair mode uses. The full `intent → GROUND → CONVERGE → SPECIFY → BUILD → FINISH` greenfield loop is complete. Each Codex sprint turn runs in an isolated worktree and only lands in your tree via a gated `jam reconcile` — a timed-out or runaway turn can't touch your working tree.

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
| **`jam report`** | Read-only, data-backed run summaries from the ledger. |

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

**New here? Start with [QUICKSTART.md](QUICKSTART.md).** Worked example: [docs/examples/production-p1.md](docs/examples/production-p1.md).

## How you use it

Two layers:

1. **The UX — slash commands + the orchestrator skill.** In any project, ask Claude to *"diagnose and fix `<repo>` toward `<goal>` with jam"*. The `jam-orchestrator` skill drives the loop; you approve at gates with `/jam:approve <gate>` and redirect with `/jam:steer "<text>"`.
2. **The mechanism — the `jam` CLI** (run under the hood by the skill as `node "${CLAUDE_PLUGIN_ROOT}/scripts/jam.mjs" <subcommand>`; also runnable by hand from a clone). The `jam <subcommand>` forms shown below are that CLI.

### Slash commands

| Command | Purpose |
|---|---|
| `/jam:start <topic>` | Begin a run |
| `/jam:status [run-id]` | Phase, gates, sprints, provenance, directives |
| `/jam:doctor` | Check Node, git, Codex CLI/auth, repo state, and version coherence |
| `/jam:approve <gate>` | Record your sign-off |
| `/jam:reject <gate>` | Refuse a human gate with a recorded reason until its artifact is re-produced |
| `/jam:steer "<text>"` | Record a durable steering directive |
| `/jam:rewind <phase>` | Move backward, re-arm target/later gates, and preserve ledger history |
| `/jam:dial <gate> <mode>` | Tighten or explicitly delegate a gate's strictness |
| `/jam:resume` | Read-only run status with one next-action hint |
| `/jam:cancel` | Cancel the run |

### CLI command reference

| Command | Purpose |
|---|---|
| `jam diagnose <topic> --goal <file>` / `jam start <topic> --mode greenfield` | Start a repair run from a goal file or a greenfield run from raw intent. |
| `jam ground sharpen --file <json>` / `jam ground claim --file <json>` / `jam ground refute --id <claimId>` / `jam ground converge --file <json>` | Shape greenfield intent, record/refute grounded claims, and close the GROUND gate. |
| `jam converge shortlist --file <json>` / `jam converge decide --agent <claude|codex> --file <json>` / `jam converge tiebreak --choose <option>` / `jam converge finalize --file <json>` | Converge Claude and Codex on one architecture decision with recorded spikes and accepted unknowns. |
| `jam specify coverage --file <json>` / `jam specify redproof` / `jam specify gameability --file <json>` / `jam specify certify` | Build and certify the project-wide acceptance bar for greenfield work. |
| `jam build plan --file <json>` | Record the greenfield BUILD sprint plan against the certified `verifyCmd`. |
| `jam status [run-id]` | Show phase, gates, sprints, Codex provenance, actions, and active directives for the active run. |
| `jam resume` | Print read-only status plus one next-action hint after a restart or context switch. |
| `jam render-digest <gateId> --file <json>` | Attach a gate digest so the supervisor can inspect and approve it. |
| `jam approve <gateId>` | Record supervisor approval for a human gate. |
| `jam reject <gateId> --reason "<text>"` | Refuse a gate until the artifact is re-produced; earlier-phase rejections tell you when to rewind. |
| `jam verify --file <verdict.json>` | Record the adversarial VERIFY verdict; blockers keep the gate closed. |
| `jam plan --file <plan.json>` | Record the repair plan and global `verifyCmd`. |
| `jam sprint <id> --start|--verify|--done` | Start a sprint, re-run the global acceptance command, and close the sprint only after verification and Codex authorship. |
| `jam codex-run --sprint <id> --prompt-file <file> --timeout <ms> --out-dir <dir>` / `jam codex-resume <sessionId> --prompt-file <file>` / `jam codex-status --event-log <file>` | Drive, resume, and inspect Codex turns; sprint turns are isolated on git projects and are never killed on timeout. |
| `jam reconcile --sprint <id>` | Land a completed isolated Codex turn through the gated reconcile path. |
| `jam advance` | Move to the next phase only when the current gate and its mechanisms are satisfied; FINISH re-runs the audit. |
| `jam rewind <phase> --confirm <phase>` | Move backward deliberately and invalidate later approvals by design. |
| `jam dial <gateId> --mode <human|show-and-proceed> [--confirm <gateId>]` | Tighten or explicitly delegate a gate's strictness. |
| `jam promote-sprint <id> --title <text> --reason <text>` | Add discovered scope as an auditable promoted sprint. |
| `jam evidence <gateId> --sprint <id> --cmd "<command>"` | Run and record sprint-scoped evidence for a gate. |
| `jam steer "<text>"` | Add a durable steering directive that remains visible at gates. |
| `jam propose-action <id> --type <type> [--target <x>] [--command <cmd>]` | Classify a consequential action before execution. |
| `jam ratify <id> --confirm <id>` / `jam ratify <id> --deny` | Human-ratify or deny an irreversible hard-blocked action. |
| `jam audit` | Re-prove run honesty: phase ordering, gate evidence, Codex authorship, promotions, and DAG order. |
| `jam report [run-id] [--all]` | Render ledger-backed run summaries without mutating state. |
| `jam review-round --phase VERIFY|SLICE --round <n> --blockers <k>` | Append an adversarial review round as a ledger fact. |
| `jam doctor` | Check Node, git, Codex CLI/auth, repo state, and version coherence. |
| `jam cancel --confirm <runId>` | Cancel the active run with explicit confirmation. |
| `jam add-gate <gateId> --mode <human|auto|show-and-proceed>` | Add a gate to the active run control surface. |

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

- **No run has yet been supervised live by a human at the gates.** Every dogfooded slice self-approved its gates under controller supervision. Your first completed [QUICKSTART](QUICKSTART.md) run retires this line.
- **The acceptance bar is only as good as your `verifyCmd`.** jam certifies and re-runs it; it cannot know what your tests fail to test.
- **jam defends against drift and accident, not a deliberately adversarial model.** Known boundaries, by design: raw in-turn shell is **not jam-governed** (the deferred G0.5 layer — on git projects, repo edits are contained by disposable worktrees; the shell itself is whatever Codex's own sandbox enforces); transcript authorship is content-bound but anchored on `CODEX_HOME` write access; hand-forged `state.json`/ledger is treated like forged git history — out of model.
- **jam is not a deployer.** It ends at FINISH with the acceptance command green; shipping is yours.

## Develop / contribute

```bash
git clone https://github.com/padmanabhaGQM/jam && cd jam
npm test          # 419 tests, no dependencies (node --test)
# drive the CLI by hand from the clone:
node plugins/jam/scripts/jam.mjs status
```

No runtime dependencies (Node ESM + `node:test`). Issues and PRs welcome.

## License

[Apache-2.0](LICENSE) © 2026 Padmanabha Banerjee (Neel). See [NOTICE](NOTICE).
