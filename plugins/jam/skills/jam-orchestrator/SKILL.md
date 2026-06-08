---
name: jam-orchestrator
description: Use to run a jam repair-mode loop — the gated DIAGNOSE→VERIFY phase engine that orchestrates Claude (systematic-debugging, brain) and Codex (independent grounding + adversarial refutation, adversary) and refuses to release a diagnosis to planning until an adversarial pass fails to break it. Invoked by /jam:diagnose.
---

# jam orchestrator — DIAGNOSE → VERIFY

You drive the asymmetric Claude–Codex loop in repair mode. **Claude is the brain** (root-cause analysis, digest assembly, gate management); **Codex is the independent adversary/grounder** (parallel diagnosis via `/codex:rescue`, adversarial refutation via `/codex:adversarial-review`); **the user supervises and approves each gate.**

## Non-negotiables

- **Never advance a phase manually.** Every state transition goes through `jam advance`. If `jam advance` reports the gate is unsatisfied, do not proceed — fix the deficiency and re-run.
- **Never hand-edit `state.json`.** All state writes go through the `jam` CLI (`diagnose`, `render-digest`, `approve`, `verify`, `advance`).
- **Both agents use their superpowers skills.** `buildGroundingPrompt` instructs Codex to use `superpowers:systematic-debugging`; `buildAdversarialPrompt` instructs it to use `superpowers:verification-before-completion`. Claude must invoke the same skills locally.
- **Claude = brain, Codex = independent adversary.** Never let Claude grade its own diagnosis; the adversarial pass must come from Codex, not Claude.

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
   Delegate an independent diagnosis to Codex, running in background:
   ```
   /codex:rescue --background
   ```
   Pass the full text produced by `buildGroundingPrompt({ goal, repoFacts, directives })` from `lib/prompting.mjs` as the prompt. Codex is instructed by that prompt to use its own `superpowers:systematic-debugging` and to deliver: a global state-map, root cause(s), and a prioritized fix-plan tagged global-structural vs local-patch. See the **Codex-hang protocol** below if the job does not complete.

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
   Pass the full text produced by `buildAdversarialPrompt({ diagnosis, goal })` from `lib/prompting.mjs`. Codex is instructed to **REFUTE the diagnosis against the source** — not nitpick wording, but find: incorrect root causes, missed failure modes, global fixes dressed as local patches. See the **Codex-hang protocol** if the job stalls.

4. **Record the verdict.**
   Capture the verdict as a JSON file. It must carry `unresolvedBlockers` (integer) or `findings[]`. Record it:
   ```bash
   jam verify --file <verdict.json>
   ```
   The gate is set to `verified` **only if** `unresolvedBlockers === 0` (or no blocker-level findings). A verdict with surviving blockers leaves the gate pending.

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
   jam advance   # → PLAN (Slice 2b-2 boundary; stop here)
   ```

---

## Codex-hang protocol (REQUIRED)

Codex `/rescue` has hung in practice. Always follow this protocol:

- Run all Codex work with `--background` and poll with `/codex:status`.
- If a job has not returned within a reasonable timeout (e.g. 5 minutes for grounding, 3 minutes for adversarial review), **do not block the loop**:
  - For the grounding pass: fall back to Claude-only analysis; note the hang in the digest's `decisions[]` as a process decision.
  - For the adversarial pass: fall back to `/codex:adversarial-review` (synchronous, shorter scope); note the fallback in the verdict.
- Surface the hang to the user so they can decide whether to cancel (`/codex:cancel`) or wait.
- **Never kill Codex processes** — use `/codex:cancel` only if the user explicitly requests it.

---

## Steering

If the user runs `/jam:steer "<directive>"` at any point, that directive is written as a durable active directive into the run state. It MUST be carried into every subsequent Codex prompt: `buildGroundingPrompt` accepts a `directives` array and renders all `status: "active"` entries into the prompt automatically. Re-check active directives before each gate. Run `jam status` to inspect the current directive list.

---

## Phase order (repair mode)

```
DIAGNOSE → VERIFY → PLAN → IMPLEMENT
                           ↑ (Slice 2b-2, not yet wired)
```

This skill covers DIAGNOSE and VERIFY. Stop at `jam advance` → PLAN and hand off to the next slice.
