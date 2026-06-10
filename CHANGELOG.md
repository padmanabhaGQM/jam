# Changelog

All notable changes to **jam** are documented here. Versions follow the plugin's
`plugin.json`. jam is **pre-alpha**: the control surface is built and tested, and the
full loop has been driven end-to-end with real Codex on a controlled repo (see 0.6.1+);
a hard repair under human gate-supervision is not yet proven.

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
