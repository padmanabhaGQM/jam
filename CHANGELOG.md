# Changelog

All notable changes to **jam** are documented here. Versions follow the plugin's
`plugin.json`. jam is **pre-alpha**: the control surface is built and tested, and the
full loop has been driven end-to-end with real Codex on a controlled repo (see 0.6.1+);
a hard repair under human gate-supervision is not yet proven.

## 0.21.0 — Usability-1: CLI-first newcomer path + drift closure
- `jam help` is registry-driven, so command discovery, per-command usage, and JSON shapes come from one source; `jam next` prints the single copy-pasteable next action, and `jam init` runs the doctor preflight, explains where run state lives and who produces what, and writes a `jam-goal.md` template (never overwriting an existing one).
- The guidance chain now uses `producerHint` end to end: refusals name the producing command, CLI spelling is consistent, sprint verify failures show the evidence tail, and Exceptions A/B are documented in behavior (`ratified` resolves hard-block gates without `jam approve`; aggregate command hints match executable forms).
- Newcomer docs were rebuilt around HOW-JAM-WORKS.md and a CLI-first QUICKSTART, including stop-hook, ledger facts, greenfield sub-gates, turn statuses, gate modes, rewind semantics, and the D1-D10 skill drift fixes.
- Audit-driven release: 3-agent fresh-eyes audit, 9 verify rounds, and `npm test` at 467 tests.
- Known-limitation roadmap: `jam start` without --mode creates an ALIGN run that cannot advance (latent; help no longer advertises it).

## 0.20.0 — Production P2: the newcomer's path
- README truth-synced (greenfield + routinely-exercised real-Codex VERIFY acknowledged; the one remaining unproven claim — live human gate-supervision — stated plainly); QUICKSTART.md is the script for that proof run; docs/examples/production-p1.md is a worked example generated from a real run ledger.
- SessionStart hook implemented (resume-powered announce; silent outside jam projects). Decorative JSON schemas removed — the JS validators are the single source of truth.
- `jam report --md` writes a wikilinked markdown report into the run directory (vault-friendly; state/ledger untouched).
- Supervisor hand-holding sections in both skills.

## 0.19.0 — Production P1: the control surface is complete
- **`jam doctor`** — environment preflight (Node, git, Codex CLI + auth, repo state, version coherence) with an actionable fix per failing check; guided errors point first-run failures at it.
- **`jam reject <gate> --reason`** — refuse a gate with a recorded reason; approval over a rejection is structurally impossible until the artifact is re-produced (audited).
- **`jam resume`** — read-only rehydration with a single next-action hint.
- **`jam rewind <phase> --confirm <phase>`** — supervised backward rollback; later-phase gates re-arm; the run-honesty audit is rewind-aware (re-advances require post-rewind artifacts).
- **`jam dial <gate> --mode`** — fail-safe gate strictness (tighten freely; loosen with typed confirm; ratification/sprint gates never dialable).
- No scaffold ("not yet implemented") surface remains.

## 0.18.0 — jam report (observability)
- `jam report [<runId>] [--json]` — a faithful, strictly read-only summary of a run from its ledger + state: wall time, phase dwell, review rounds + rounds-to-zero, sprint durations + authorship/evidence, turn-isolation stats, final-verification, audit. `jam report --all` lists every run one line each (corrupt run dirs tolerated).
- `jam review-round --phase VERIFY|SLICE --round <n> --blockers <k>` — append-only, audit-inert ledger enrichment so future runs carry round-level review data (historical runs render an explicit "round-level review data not recorded" note instead of invented numbers).

## 0.17.0 — Turn-lifecycle repo safety
- A Codex sprint turn now runs in an **isolated git worktree** seeded from a checkpoint of the working tree (tracked + untracked, large tracked blobs sparse-excluded). A running, timed-out, or superseded turn **cannot mutate the controller's tree or HEAD** — the only ingress is `jam reconcile --sprint <id>`, gated on the turn's generation token, its bound Codex session, turn completion, and no main-tree drift.
- `jam reconcile` applies the turn's net diff to the main tree (preserving in-progress dirty work); `sprint --verify`/`--done` refuse while an isolated turn is un-reconciled. never-kill is preserved — a runaway turn is contained in a disposable worktree, never signalled.
- Non-git targets fall back to in-place editing with a visible warning + a `turn-unisolated` ledger entry. Bonus: worktree isolation incidentally contains a destructive in-turn shell to the throwaway worktree.

## 0.16.0 — Foundation hardening (FINISH liveness + content-bound authorship)
- Advancing to FINISH (repair IMPLEMENT→FINISH and greenfield BUILD→FINISH) now **re-runs the locked `verifyCmd` against the current workspace** and refuses if it is red — a run can no longer FINISH on stale per-sprint evidence. A `final-verification` ledger entry is recorded, and `jam audit` requires it after the last sprint.
- Codex authorship binding is **content-bound**: `bindCodexSession` accepts the located rollout only if its `session_meta.payload.id` equals the bound session id (filename substring matching alone was forgeable). Honest boundary: this authenticates file↔session identity, not diff authorship, and is bounded by who can write `CODEX_HOME/sessions`.

## 0.15.0 — BUILD phase (ganjam G4) — greenfield loop complete
- Greenfield's final phase: wire the certified verifyCmd SSOT into a locked build plan and run the existing gated sprint loop to FINISH.
- `state.plan.verifyCmd` is LOCKED to the certified SSOT (`recordBuildPlan` rejects any other) — you build to exactly the bar you certified.
- BUILD reuses repair's IMPLEMENT machinery (sprint --start/--verify/--done, role-binding, DAG, promotion); advance BUILD→FINISH requires the BUILD-plan gate approved + all sprints done + a passing run-honesty audit.
- The run-honesty audit is now **mode-aware** (validates the greenfield phase order GROUND→CONVERGE→SPECIFY→BUILD and each phase's producing artifact).
- Hardening: `advancePhase` now requires EVERY gate of a greenfield phase (main + sub-gates) approved before advancing.
- `jam build plan`. The full `intent → GROUND → CONVERGE → SPECIFY → BUILD → FINISH` loop is complete.

## 0.14.0 — SPECIFY phase (ganjam G3)
- Greenfield's third phase: author the project's GLOBAL `verifyCmd` as a human-ratified SSOT.
- Un-gameable triad before ratification: RED-FIRST (verifyCmd must exit non-zero on the un-built project), COVERAGE (every G2 acceptance dimension bound to ≥1 check), and a Codex GAMEABILITY audit (zero surviving "hollow check" findings).
- Two gates: `SPECIFY-coverage` → `SPECIFY` (the SSOT). Editing the suite re-arms the gate and clears stale proofs.
- `jam specify coverage|redproof|gameability|certify`. The certified verifyCmd is what BUILD (G4) will gate on.
- `BUILD` remains a stub (ships in G4).

## 0.13.0 — CONVERGE phase (ganjam G2)
- Greenfield's second phase: adversarial decision-convergence from the grounded-intent to one evidence-backed, human-ratified decision.
- Two independent decisions (Claude + Codex); agreement converges, disagreement raises a `CONVERGE-tiebreak` gate the human rules.
- Decision-ledger covers every G1 dimension; `satisfied` requires a registered real Codex spike transcript, `unmet` requires explicit acceptance, every G1 open-unknown must be accepted. Any post-decision mutation re-arms the gate.
- Three gates: `CONVERGE-shortlist` → (conditional) `CONVERGE-tiebreak` → `CONVERGE`. `jam converge shortlist|decide|tiebreak|finalize`.
- `SPECIFY/BUILD` remain stubs (ship in G3/G4).

## 0.12.0 — Greenfield mode + GROUND phase (ganjam G1)
- New **greenfield** mode (`jam start --mode greenfield`) alongside repair mode; `lib/mode.mjs` owns both phase orders.
- The **GROUND** phase turns a raw intent into an evidence-backed grounded-intent via two adversarial groundings and a claim-ledger.
- Two mechanism-bound human gates: `GROUND-scope` (sharpened intent, before research) and `GROUND` (converged grounding). A feasibility claim is only `evidenced` with a real Codex probe transcript.
- `CONVERGE/SPECIFY/BUILD` are defined as stub phases that refuse to advance (ship in G2–G4).
- `jam ground sharpen|claim|refute|converge`; `jam status` shows mode + grounding.

## 0.11.0 — Hard-block / reversibility tier (first greenfield brick)
- Every consequential action is classified by reversibility (`jam propose-action <id> --type <t>`). The classifier is **fail-safe**: an unrecognized type requires ratification rather than silently passing.
- Irreversible actions (`delete`, force-push, `DROP`, infra-destroy, deploy, restart-rearchitect, …) are **hard-blocked** behind a human ratification gate that opens only via `jam ratify <id> --confirm <id>` (typed confirm must equal the id) or `--deny`. `/jam:approve` cannot open it.
- `jam cancel` (itself irreversible) now requires a typed `--confirm <runId>`.
- The FINISH audit refuses while any irreversible action is undecided. **Agent consensus can never authorize a catastrophe.**
- Honest boundary: governs declared actions + jam's own ops; raw `--type run` shell commands are best-effort screened (full raw-shell coverage is a later slice).

## 0.10.0 — Sprint dependency DAG
- Sprints can declare `needs: [ids]` → an acyclic dependency graph.
- `validateSprintGraph` rejects cycles / dangling refs / self-deps at `plan` and `promote-sprint`.
- `startSprint` blocks a sprint until its dependencies are `done`; `jam status` shows `(ready)`/`(blocked)`.
- The run-honesty audit verifies the recorded order was honored (no sprint started before a dependency finished).

## 0.9.0 — Promotion / authority governance
- Every sprint carries `provenance`: `planned` (in the approved plan) or `promoted` (added mid-run).
- `jam promote-sprint <id> --reason …` records a promotion decision + ledger entry; scope can't expand silently.
- Enforced at `startSprint` and the FINISH audit.

## 0.8.0 — Run-honesty audit
- `jam audit` re-proves the ledger: phase ordering, Codex authorship, evidence, and state↔ledger consistency.
- Advancing to FINISH refuses on a dishonest/inconsistent ledger.

## 0.7.0 — Role-binding gate
- A sprint cannot be `done` without a **bound Codex session whose transcript exists** — structurally enforces "Codex is the hands."
- `jam codex-run --sprint <id>` records the authorship; `validateState` enforces it at the persistence layer.

## 0.6.1 — Real-codex smoke
- Opt-in smoke proving the owned Codex engine drives the real `codex` binary (event names, last-message, transcript location). The engine is no longer verified against a fake only.

## 0.6.0 — Gated IMPLEMENT loop (M3b)
- Per-sprint loop: `jam sprint <id> --start|--verify|--done`, each gated by the project's **global `verifyCmd`** — no sprint completes until the whole acceptance command exits 0. IMPLEMENT advances to FINISH only when all sprints are done.

## 0.5.0 — Gated PLAN phase (M3a)
- `jam plan --file plan.json` records + gates a `{ verifyCmd, sprints[] }` plan; the PLAN gate is mechanism-bound.

## 0.4.0 — Control core + run-control + DIAGNOSE→VERIFY + Codex engine (M1)
- Deterministic control surface (mechanism-bound gates, evidence, immutable ledger, digests, steering).
- Owned Codex engine over `codex exec` / `resume`: **never kills** a process (timeouts surface, stay resumable); live-thread reconciliation.
- Gated repair-mode DIAGNOSE→VERIFY orchestrator.
