# How jam works

jam's rule is: trust the structure, not the model.
Claude orchestrates, Codex produces, you approve, and jam referees the run with deterministic state, gates, evidence, and audit checks.
Every consequential step becomes an append-only ledger fact.
Before FINISH, jam re-proves the ledger history and re-runs the live acceptance command.

## The two state machines

Repair mode fixes or hardens an existing repo:

```text
DIAGNOSE -> digest (4-detector proof) -> gate DIAGNOSE -> you approve ->
VERIFY -> adversarial verdict, 0 blockers -> gate VERIFY -> you approve ->
PLAN -> sprint DAG + verifyCmd -> gate PLAN -> you approve ->
IMPLEMENT -> per-sprint: isolated Codex turn -> reconcile -> verifyCmd -> auto gates ->
FINISH -> audit PASS + live verifyCmd re-run -> done

DIAGNOSE → VERIFY → PLAN → IMPLEMENT → FINISH
```

Greenfield mode builds from raw intent:

```text
GROUND -> grounded intent -> gates GROUND-scope + GROUND -> you approve ->
CONVERGE -> architecture decision -> gates CONVERGE-shortlist + CONVERGE -> you approve ->
SPECIFY -> certified verifyCmd -> gates SPECIFY-coverage + SPECIFY -> you approve ->
BUILD -> sprint DAG locked to the certified verifyCmd -> gate BUILD-plan -> you approve ->
BUILD -> per-sprint: isolated Codex turn -> reconcile -> verifyCmd -> auto gates ->
FINISH -> audit PASS + live verifyCmd re-run -> done

GROUND → CONVERGE → SPECIFY → BUILD → FINISH
```

The greenfield sub-gates are incremental checkpoints inside research phases. `GROUND-scope`, `CONVERGE-shortlist`, and `SPECIFY-coverage` must be satisfied alongside their phase gates before advancing.

## The sprint engine

IMPLEMENT and greenfield BUILD use the same sprint loop: start the next DAG-ready sprint, let Codex work in an isolated turn, reconcile the turn, run the global `verifyCmd`, then mark the sprint done only after evidence and Codex authorship are present.

An isolated turn is Codex working in a locked room on a photocopy of the repo. `jam reconcile --sprint <id>` checks that the photocopy still matches the original baseline before merging it back. If the original moved while Codex was working, reconcile refuses the merge instead of guessing.

## Five concepts that unlock everything

**Digest.** A digest is a four-detector proof for a human gate, not a form. It records the diagnosis summary, architecture trace, decisions, global map, and coverage so you can approve the trajectory instead of reading only diff lines.

**verifyCmd.** `verifyCmd` is the whole acceptance bar: tests, lint, types, validators, or whatever command actually proves the project is acceptable. Sprint verification and FINISH both use it to kill local-green/global-broken work.

**Reconcile.** Reconcile is the gated merge for an isolated Codex turn. It lands Codex work only when the turn token, baseline, session binding, and worktree state line up.

**Ratify.** Ratify is the two-key launch path for irreversible actions. Agent consensus can propose or review a catastrophe, but it cannot authorize one; you type the action id yourself with `jam ratify <id> --confirm <id>`.

**Ledger + audit.** The ledger is the append-only history of state changes. FINISH runs an audit over those ledger facts, gate states, sprint order, evidence, and Codex authorship; forged approvals or inconsistent histories do not survive it.

**Stop-hook.** When a gate is unsatisfied, jam's hook blocks the agent's turn from ending and shows the reason. The nag is the feature: it keeps the run at the unresolved gate until the required artifact, approval, evidence, or ratification exists.

## Glossary

| Term | Meaning |
|---|---|
| action | A consequential operation proposed through `jam propose-action`; irreversible actions require ratification. |
| advance | The phase transition command; it refuses when the current gate, sprint set, audit, or live verification is not satisfied. |
| approved | Gate status meaning the human approval has been recorded for a human gate. |
| audit | The FINISH honesty check over phase order, gate evidence, Codex authorship, promotions, DAG order, and final verification. |
| BUILD | Greenfield implementation phase; it records a sprint plan locked to the certified `verifyCmd`. |
| Codex | The producer role: it writes code, review artifacts, and evidence in recorded turns. |
| contested | Gate status for a convergence tiebreak that must be resolved with `jam converge tiebreak --choose <option>`. |
| covered | Gate status meaning SPECIFY coverage has been recorded. |
| decided | Gate status meaning the convergence decision has been finalized. |
| dial | Gate-mode control that can tighten or explicitly delegate a gate between `human` and `show-and-proceed`. |
| digest | The four-detector proof attached to a rendered gate before approval. |
| discarded | Turn status meaning an open turn was abandoned and cannot be reconciled as the current sprint turn. |
| evidence-passed | Gate status for auto gates after their evidence command exits 0. |
| FINISH | Final phase reached only after sprint completion, audit pass, and live `verifyCmd` re-run. |
| gate | A phase or sprint checkpoint whose mode and status determine whether the run can advance. |
| greenfield | Mode for building from raw intent through `GROUND → CONVERGE → SPECIFY → BUILD → FINISH`. |
| GROUND | Greenfield phase that scopes and grounds the raw intent before architecture convergence. |
| grounded | Gate status meaning grounded intent has converged. |
| human | Gate mode requiring explicit human approval after the required producer artifact exists. |
| IMPLEMENT | Repair phase that runs the sprint engine after PLAN approval. |
| ledger | Append-only JSONL history of run facts such as approvals, turns, evidence, reviews, and phase changes. |
| open | Turn status meaning an isolated Codex turn is active and must reconcile, be resumed, or be discarded. |
| pending | Initial gate status before its required artifact or evidence is produced. |
| planned | Gate status meaning a repair or BUILD sprint plan has been recorded. |
| promotion | A recorded addition of required sprint scope discovered after the approved plan. |
| ratified | Gate or action status meaning the typed human confirmation for an irreversible action has been recorded. |
| ratify | The command path for authorizing or denying irreversible proposed actions. |
| reconcile | The command that merges an isolated Codex turn back only if provenance and baseline checks pass. |
| reconciled | Turn status meaning the isolated turn has landed through `jam reconcile`. |
| rejected | Gate status meaning a human refused the artifact with a reason; it must be re-produced before approval. |
| rendered | Gate status meaning a digest has been attached for a digest-backed gate. |
| repair | Mode for fixing an existing repo through `DIAGNOSE → VERIFY → PLAN → IMPLEMENT → FINISH`. |
| rewind | A deliberate phase move backward that re-arms later gates and preserves history. |
| scoped | Gate status meaning the greenfield GROUND scope checkpoint has been recorded. |
| shortlisted | Gate status meaning CONVERGE shortlist options have been recorded. |
| show-and-proceed | Gate mode that allows advance once the artifact exists, without a separate approval. |
| specified | Gate status meaning SPECIFY has certified the project acceptance bar. |
| sprint | A DAG node of implementation work with acceptance criteria, dependencies, a Codex turn, evidence, and done state. |
| stop-hook | Claude Code hook that blocks turn completion when a jam gate is unsatisfied and prints the gate reason. |
| turn | One Codex work attempt bound to a sprint by token, session id, transcript, and status. |
| unisolated | Reported turn category for non-git runs where Codex could not use a disposable worktree. |
| verified | Gate status meaning an adversarial verdict or verification artifact has passed its blocker rule. |
| verifyCmd | The project-wide acceptance command; every sprint and FINISH use it as the global bar. |
