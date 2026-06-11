---
name: jam-orchestrator
description: Use to run a jam repair-mode loop — the gated DIAGNOSE→VERIFY→PLAN→IMPLEMENT repair engine that orchestrates Claude (brain) and Codex (independent adversary/hands) and refuses to release work past each gate until the controls are satisfied. Invoked by /jam:diagnose.
---

# jam orchestrator — DIAGNOSE → VERIFY → PLAN → IMPLEMENT

You drive the asymmetric Claude–Codex loop in repair mode. **Claude is the brain** (root-cause analysis, digest assembly, gate management); **Codex is the independent adversary/grounder** (parallel diagnosis via jam's own codex engine, adversarial refutation via `/codex:adversarial-review`); **the user supervises and approves each gate.**

> This skill drives ganjam's **repair (jam) mode**. For build-from-intent, see the `jam-greenfield` skill (`jam start --mode greenfield`).

## Non-negotiables

- **Never advance a phase manually.** Every state transition goes through `jam advance`. If `jam advance` reports the gate is unsatisfied, do not proceed — fix the deficiency and re-run.
- **Never hand-edit `state.json`.** All state writes go through the `jam` CLI (`diagnose`, `render-digest`, `approve`, `verify`, `advance`).
- **Both agents use their superpowers skills.** `buildGroundingPrompt` instructs Codex to use `superpowers:systematic-debugging`; `buildAdversarialPrompt` instructs it to use `superpowers:verification-before-completion`. Claude must invoke the same skills locally.
- **Claude = brain, Codex = independent adversary.** Never let Claude grade its own diagnosis; the adversarial pass must come from Codex, not Claude.
- **Agent agreement is never authority for an irreversible action.** No consensus between Claude and Codex can authorize deleting a codebase, a force-push, a `DROP`, an infra-destroy, or a delete-and-restart. Irreversible actions are hard-blocked until the human types a ratification. See below.

### Hard-block tier — irreversible actions

For any consequential action (anything beyond editing files / running safe commands), declare it first:
```
jam propose-action <id> --type <type> [--target <path>] [--command <cmd>]
```
jam classifies it by reversibility. Reversible → proceed. **Irreversible** (`delete-path`, `git-history-rewrite`, `git-force-push`, `db-drop`, `destructive-migration`, `infra-destroy`, `deploy`, `send-external`, `restart-rearchitect`, or a destructive command like `rm -rf`, `git push --force`, `DROP TABLE`, `terraform destroy`) → **HARD-BLOCKED** behind a human ratification gate. It opens ONLY when the human types:
```
jam ratify <id> --confirm <id>     # grant (the phrase must equal the action id)
jam ratify <id> --deny             # refuse
```
`/jam:approve` cannot open it. `jam cancel` (itself irreversible) requires `--confirm <runId>`. The FINISH audit refuses to pass while any irreversible action is still undecided.

**Declare by specific type, not by raw command.** The fail-safe guarantee lives in the *type* allowlist (an unrecognized type requires ratification). The command screen on `--type run` is a best-effort backstop and is deliberately incomplete — shell is open-ended. So declare a destructive operation with its real type (`jam propose-action drop-users --type db-drop`, `--type delete-path`, …), NOT as a generic `--type run "<cmd>"` that hopes the regex catches it. Reserve `--type run` for genuinely safe commands (tests, builds, linters).

**Honest boundary:** this governs *declared* actions plus jam's own destructive ops — it does NOT yet intercept Codex's raw in-turn sandbox shell (the deferred **G0.5** slice). Until then, the orchestrator must declare consequential actions via `propose-action` rather than letting Codex run them unannounced. Likewise, a raw `--type run` command is only pattern-screened, not fully classified — full raw-shell coverage is the G0.5 layer.

---

## DIAGNOSE phase

**Trigger:** `/jam:diagnose`, or the user says "diagnose and fix `<repo>` toward `<goal>` with jam".

### Steps

1. **Start the run in repair mode.**
   ```bash
   jam diagnose "<topic>" --goal <goal-file>
   # or, for a codex-stored goal:
   jam diagnose "<topic>" --goal-codex <goalId>
   ```
   This creates the active run, sets the phase to DIAGNOSE, and persists `goal.md`.

2. **Claude: find the root cause first.**
   Invoke `superpowers:systematic-debugging`. Do NOT propose fixes yet. Ground the analysis in concrete repo evidence: source code, validators, the latest `validation_report*` files, logs, the cost ledger — all weighed against the acceptance goal. Identify root causes that are **global and structural**, not local-pass/global-break patches.

3. **Codex: independent grounding pass.**
   Delegate an independent diagnosis to Codex via jam's own codex engine — **not** `/codex:rescue`. Concretely:

   a. Write the full text produced by `buildGroundingPrompt({ goal, repoFacts, directives })` from `lib/prompting.mjs` to a file (e.g. `<run>/codex/diagnose/prompt.md`).

   b. Start the turn:
      ```bash
      node "${CLAUDE_PLUGIN_ROOT}/scripts/jam.mjs" codex-run \
        --prompt-file <run>/codex/diagnose/prompt.md \
        --timeout 300000 \
        --out-dir <run>/codex/diagnose
      ```
      The command prints `status: completed|timed_out`, `session: <id>`, and `out-dir: <dir>`. On completion it also prints `message:` — that is Codex's grounding result.

   c. Read the printed `message:` as Codex's grounding result. If you need to continue the thread (e.g. to ask a follow-up), use:
      ```bash
      node "${CLAUDE_PLUGIN_ROOT}/scripts/jam.mjs" codex-resume <sessionId> \
        --prompt-file <reply.md> \
        --out-dir <run>/codex/diagnose
      ```

   Codex is instructed by `buildGroundingPrompt` to use its own `superpowers:systematic-debugging` and to deliver: a global state-map, root cause(s), and a prioritized fix-plan tagged global-structural vs local-patch. See the **Codex-hang protocol** below if the turn times out.

4. **Reconcile and build the 4-detector digest.**
   Merge Claude's findings with Codex's result into a single digest JSON that contains **all four detectors**:

   | Field | Required shape |
   |---|---|
   | `summary` | string |
   | `traceToArchitecture.componentsTouched` | string[] |
   | `decisions[]` | `{choice, alternatives[], why}` each |
   | `globalMap.mermaid` | string (Mermaid diagram) |
   | `globalMap.currentPosition` | string |
   | `globalMap.isLocallyScopedRisk` | boolean — **true if the fix looks like a local hack** |
   | `coverage.addressed` | string[] |
   | `coverage.dropped` | string[] |

   `validateDigest` in `lib/digest.mjs` enforces this shape. Render and record:
   ```bash
   jam render-digest DIAGNOSE --file <digest.json>
   ```

5. **Present the rendered digest and request approval.**
   Show the rendered output (produced by `renderDigest` in `lib/digest.mjs`). Highlight any `isLocallyScopedRisk: true` flag — it means the proposed fix is local, not global, and the user should decide whether to proceed. Request human sign-off:
   ```
   /jam:approve DIAGNOSE
   ```

---

## VERIFY phase

### Steps

1. **Advance to VERIFY.**
   ```bash
   jam advance
   ```
   If `jam advance` refuses (gate unsatisfied), fix the deficiency; do not force progress.

2. **Claude: pre-flight verification.**
   Invoke `superpowers:verification-before-completion`. Confirm the diagnosis is self-consistent, grounded in actual source evidence, and free of assumption-only claims before sending it to adversarial review.

3. **Codex: adversarial refutation pass.**
   ```
   /codex:adversarial-review --background
   ```
   Pass the full text produced by `buildAdversarialPrompt({ diagnosis, goal })` from `lib/prompting.mjs`. Codex is instructed to **REFUTE the diagnosis against the source** — not nitpick wording, but find: incorrect root causes, missed failure modes, global fixes dressed as local patches. See the **Codex-hang protocol** if the job stalls. (`/codex:adversarial-review` is read-only and retained here; M1 moved only the delegation/authoring lane — the grounding pass — to the jam engine.)

4. **Record the verdict.**
   Capture the verdict as a JSON file. It must carry `unresolvedBlockers` (integer) or `findings[]`. Record it:
   ```bash
   jam verify --file <verdict.json>
   ```
   The gate is set to `verified` **only if** `unresolvedBlockers === 0` (or no blocker-level findings). A verdict with surviving blockers leaves the gate pending.
   Record EVERY adversarial round, not only the passing one: each round, `jam verify --file <verdict.json>` (a failing verdict appends a `verification` entry with its blocker count) AND `jam review-round --phase VERIFY --round <n> --blockers <k>`. After FINISH, record each whole-slice review round with `jam review-round --phase SLICE --round <n> --blockers <k>`. `jam report` then reproduces the run's quality story from the ledger.

5. **Blockers survived → revise the diagnosis.**
   If `jam verify` reports the gate is still pending (blockers survived), the diagnosis is **not safe to plan from**. Do not advance. Return to DIAGNOSE:
   - Address each blocker in the root-cause analysis.
   - Rebuild the digest with updated findings.
   - Re-render and re-record: `jam render-digest DIAGNOSE --file <updated-digest.json>`.
   - Re-request `/jam:approve DIAGNOSE`, then re-run the VERIFY steps above.

6. **Clean → approve and advance to PLAN.**
   Once `jam verify` confirms no blockers:
   ```
   /jam:approve VERIFY
   jam advance   # → PLAN
   ```

---

## PLAN phase

### Steps

1. **Enter PLAN.**
   ```bash
   jam advance
   ```
   Run this after VERIFY has been approved. If `jam advance` refuses (gate unsatisfied), satisfy the gate first — do not proceed manually.

2. **Author the plan.**
   Invoke `superpowers:writing-plans`. Working from the verified, adversarially-cleared diagnosis, decompose the fix into **sprints**: each sprint must be global-structural (not a local patch), tied to the goal's gates, and independently verifiable. Alongside the sprint list, define **`verifyCmd`** — the project's *global* acceptance gate (validators + reviewer scores; the command must exit 0 if and only if the goal's gates pass). The plan is not done until both are present.

3. **Challenge it.**
   Run `/codex:adversarial-review` on the plan. Codex must look for sequencing errors, gaps between sprints, and local-patch smells that would break the global acceptance gate. Resolve any blocker-level findings before recording.

4. **Record + gate.**
   Write `plan.json` with the shape:
   ```json
   { "verifyCmd": "...", "sprints": [{ "id": "...", "title": "...", "acceptanceCriteria": "..." }] }
   ```
   Then record it and flip the PLAN gate:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/jam.mjs" plan --file plan.json
   ```
   **The PLAN gate is plan-bound.** A digest or an adversarial-review verdict cannot satisfy it; only a valid recorded plan flips it to `planned`.

5. **Approve + advance to IMPLEMENT.**
   ```bash
   /jam:approve PLAN
   jam advance   # → IMPLEMENT
   ```

---

## IMPLEMENT phase

Work the sprint list **one at a time, in order**. Each sprint is gated by the run's **global `verifyCmd`** — jam runs it itself and a sprint cannot be marked `done` unless it exits 0. Because `verifyCmd` is the *whole project's* acceptance command (validators + reviewer scores), **no sprint completes until the global gate passes** — the anti-local-fix property: local green is never enough. A sprint also cannot be marked `done` unless a **Codex session authored it** — a bound session with a locatable transcript. That is enforced by `finishSprint` (machinery, not prose): Claude must not write the implementation.

### Per sprint, in order

1. **Start the sprint.**
   ```bash
   jam sprint <id> --start
   ```
   Marks it `in-progress` and seeds its auto gate.

2. **Implement via the engine (Codex, write-capable).**
   Write the full text produced by `buildSprintPrompt({ sprint, goal, directives })` from `lib/prompting.mjs` to a file, then run the turn:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/jam.mjs" codex-run \
     --sprint <id> \
     --prompt-file <run>/codex/<id>/prompt.md \
     --timeout 600000 \
     --out-dir <run>/codex/<id>
   ```
   The sprint cadence is `--start → codex-run --sprint (runs in an isolated worktree) → jam reconcile --sprint → --verify → --done`. `buildSprintPrompt` instructs Codex to use `superpowers:test-driven-development`, implement **exactly** this sprint, honor active steering directives, and return exact evidence. Passing `--sprint <id>` binds this Codex session (id + transcript) to the sprint — the authorship record step 6 requires. A timed-out ISOLATED sprint turn is not resumed via `codex-resume` — wait for the turn (never killed) and run `jam reconcile --sprint <id>`, or open a fresh superseding `jam codex-run --sprint <id>`. The **Codex-hang protocol** (never-kill + live-thread reconciliation) applies to every engine call here; a timed-out turn is reconciled, not lost, once it completes.

3. **Reconcile the isolated turn.**
   ```bash
   jam reconcile --sprint <id>
   ```
   Applies the completed isolated worktree turn to the main tree through jam's gate. `jam sprint <id> --verify` and `--done` refuse while an isolated turn is still un-reconciled.

4. **Verify against the global gate.**
   ```bash
   jam sprint <id> --verify
   ```
   jam runs the **global `verifyCmd`**; the sprint passes only on exit 0. If it fails, do not force — iterate (more `codex-run` on the same thread) or take a `/jam:steer` directive, then re-verify.

5. **Second, non-author check + digest.**
   Run `/codex:adversarial-review` on the diff (an independent read of the change). Render a digest and surface it to the user.

6. **Human go/no-go.**
   ```bash
   jam sprint <id> --done
   ```
   Refuses unless the sprint is verified (global `verifyCmd` exited 0) **and** a Codex session authored it (a bound session with a locatable transcript). This is the user's sign-off to close the sprint.

7. **Next sprint.** Repeat 1–6 for each. When all sprints are `done`:
   ```bash
   jam advance   # → FINISH (refuses unless ALL sprints done AND the honesty audit passes)
   ```

State it plainly to the user: **a sprint cannot be `done` unless the global `verifyCmd` passes — local green is not enough.** That is what structurally ends the locally-correct-globally-broken loop.

Advancing to FINISH also runs the **run-honesty audit** (`jam audit`): it re-checks the ledger so far — phase order, that each approval was preceded by its producing digest/verdict/plan, and that every done sprint has a Codex-bound session with a live transcript and a passing evidence record — and refuses FINISH if the recorded process is inconsistent or forged. Run `jam audit` anytime to check a run's integrity.

If implementation surfaces scope beyond the approved plan — a new sprint Codex or the diagnosis reveals — it must be **promoted**, never silently worked: `jam promote-sprint <id> --title <t> --reason <why>`. A promotion is recorded (provenance `promoted` + a `promotions` decision) and surfaced in `jam status`; `startSprint` refuses scope with no provenance and the FINISH audit refuses a `promoted` sprint with no decision trail. Promoting adds an undone sprint, so FINISH correctly waits for the new scope to be implemented, verified, and done.

Sprints form a **dependency DAG**: a sprint declares `needs: [ids]` (in `plan.json`, or via `jam promote-sprint … --needs a,b`) and cannot `--start` until its dependencies are `done`. The graph must be acyclic — a cyclic or dangling-reference plan is rejected at PLAN, and a promotion that would create a cycle is refused — and the FINISH audit proves the recorded order was honored (no sprint started before a dependency finished). `jam status` shows each sprint as `(ready)` or `(blocked)`; work the ready ones in dependency order.

---

## Codex-hang protocol (REQUIRED)

Codex turns can time out in practice. jam's engine **never kills** a Codex process; neither do you. Always follow this protocol:

**Grounding pass (`codex-run` reports `status: timed_out`):**
- The Codex process **may still be running**. Do NOT kill it — not now, not as a cleanup step.
- Surface the situation to the user immediately: report the `session:` id printed by `codex-run` and the `out-dir`.
- Keep the session id. You can resume the turn later:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/jam.mjs" codex-resume <sessionId> \
    --prompt-file <reply.md> \
    --out-dir <run>/codex/diagnose
  ```
- If you cannot wait (user wants to proceed), fall back to Claude-only analysis for the grounding pass and note the timeout in the digest's `decisions[]` as a process decision.
- Any cancellation is the user's responsibility via `/codex:cancel` or a manual kill — you must not initiate it.

**Adversarial pass (`/codex:adversarial-review` stalls):**
- Same never-kill rule applies. Surface it to the user; note the fallback in the verdict.
- You may fall back to a tighter `/codex:adversarial-review` scope; note the fallback in the verdict.

**Before answering after any pause, timeout, or resume:**
Run `jam codex-status --event-log <run>/codex/<step>/events.jsonl` to read the live turn, and reconcile (`reconcile` in `lib/codex/reconcile.mjs`) the live question against your local pending one. Answer the **live thread** — never from stale memory of what you thought the session state was.

---

## Steering

If the user runs `/jam:steer "<directive>"` at any point, that directive is written as a durable active directive into the run state. It MUST be carried into every subsequent Codex prompt: `buildGroundingPrompt` accepts a `directives` array and renders all `status: "active"` entries into the prompt automatically. Re-check active directives before each gate. Run `jam status` to inspect the current directive list.

---

## Phase order (repair mode)

```
DIAGNOSE → VERIFY → PLAN → IMPLEMENT → FINISH
```

This skill covers the full repair loop: DIAGNOSE, VERIFY, PLAN, IMPLEMENT, and the advance to FINISH.
