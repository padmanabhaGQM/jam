---
name: jam-greenfield
description: Use to run ganjam's greenfield mode — the full GROUND→CONVERGE→SPECIFY→BUILD→FINISH loop that turns a raw intent into an evidence-backed, human-ratified build through a locked verifyCmd and gated sprint loop. Invoked by `jam start --mode greenfield`.
---

# jam — greenfield mode

You drive ganjam's **greenfield** mode: build-from-intent. This is the sibling of repair mode (see `jam-orchestrator`). The full `GROUND → CONVERGE → SPECIFY → BUILD → FINISH` loop is live: ground intent, converge on one decision, certify the global verifyCmd SSOT, then build through the gated sprint loop to FINISH.

**Claude is the brain, Codex is the independent adversary/researcher, the human is the director** who ratifies each gate. Agent agreement is never authority (G0 still governs any irreversible probe command — declare it via `jam propose-action`).

## Driving with a human supervisor (or new to jam?)

Start every session with `jam resume`. It shows the active greenfield phase, pending gate, blockers, and next action. After a restart or long pause, run `jam resume` before trusting memory.

If the environment drifted, run `jam doctor` and fix the reported setup issue before continuing. For the supervised-run script, see `QUICKSTART.md`.

At every gate, surface the recorded artifact VERBATIM. The human is deciding on the exact thing jam will treat as authoritative:

- `GROUND-scope`: show the sharpened intent exactly as recorded. The sharpened intent IS the contract for research; the human decides whether the problem statement and acceptance dimensions are the right target before any probe work starts.
- `GROUND`: show the claim ledger and grounded intent. Every feasibility claim must carry a probe transcript; open unknowns must be explicit; the human decides whether the evidence is enough to move from framing to decision.
- `CONVERGE-shortlist`: show the shortlisted candidates before spikes. The human decides whether the option set is worth spending evidence-gathering time on.
- `CONVERGE`: show the final decision, spike transcript references, satisfied dimensions, and accepted unknowns. The human decides whether this is the one build direction and which risks are knowingly accepted.
- `SPECIFY-coverage`: show the proposed `verifyCmd`, checks, and dimension coverage before red-first/gameability work. The human decides whether the acceptance surface is the right one to harden.
- `SPECIFY`: show the certified acceptance bar verbatim: red-first proof, coverage, and gameability audit. The human is signing the acceptance bar that will govern BUILD.
- `BUILD-plan`: show the sprint breakdown, dependency order, acceptance criteria, and locked `verifyCmd`. The human decides whether the build sequence is complete and appropriately gated.
- Sprint close and FINISH: show the evidence, transcript/session binding, global verification result, audit, and live final verification result.

Their verbs are approve and reject:
```bash
jam approve <gate>
jam reject <gate> --reason "..."
```

A rejection is a standing objection. Nothing advances until the artifact is re-produced and surfaced again. If the artifact is wrong, rewrite and re-record it; if the direction is wrong, use `jam rewind <phase> --confirm <phase>` and accept that later approvals are invalidated by design.

## Non-negotiables
- **Never hand-edit `state.json`.** All writes go through the `jam` CLI.
- **Both agents use their superpowers skills at every step** (below).
- **Evidence over assertion.** A feasibility claim is only `evidenced` if it carries a real Codex probe transcript. You (Claude) cannot self-assert feasibility.
- **Two independent groundings, then cross-examination.** Do not let one side's framing stand unchallenged.
- **Record review rounds.** Record EVERY adversarial review turn, not only the passing one: each turn, `jam verify --file <verdict.json>` (a failing verdict appends a `verification` entry with its blocker count) AND `jam review-round --phase VERIFY --round <n> --blockers <k>`. After FINISH, record each whole-slice review round with `jam review-round --phase SLICE --round <n> --blockers <k>`. `jam report` then reproduces the run's quality story from the ledger.

## The GROUND flow
1. **Sharpen the intent** — invoke `superpowers:brainstorming` to turn the raw intent (`goal.md`) into a crisp problem statement + acceptance dimensions. Write `{problem, dimensions}` and run:
   ```bash
   jam ground sharpen --file sharpen.json
   ```
   Present the sharpened frame to the human: **`jam approve GROUND-scope`** before any research.
2. **Two independent groundings** (only after GROUND-scope is approved):
   - **Codex grounding** — via jam's owned engine: `jam codex-run --prompt-file ground.md --cwd <repo> --out-dir <d>`. Instruct Codex to use `superpowers:systematic-debugging`, to research prior art + option-space, and to run **feasibility probes** (read APIs/docs, tiny experiments) — its transcript is the evidence. Any consequential command goes through `jam propose-action`/`jam ratify`.
   - **Claude grounding** — you produce your own independent framing, unknowns, and option-space.
3. **Cross-examine** — invoke `superpowers:verification-before-completion`. Each side attacks the other's claims. Record surviving claims with `jam ground claim --file claim.json` (`kind: feasibility|framing|option`, `status: evidenced|open-unknown`, feasibility-evidenced needs `evidenceRef` = the probe transcript path). Drop refuted claims with `jam ground refute --id <id>`.
4. **Converge** — `jam ground converge --file converge.json` (`{options, openUnknowns}`). This refuses unless every claim is `evidenced`/`open-unknown` and every feasibility claim has a locatable transcript. On success the `GROUND` gate flips to `grounded`.
5. **Ratify** — present the grounded-intent to the human: **`jam approve GROUND`**. Then `jam advance` (which, in G1, reports `CONVERGE` ships in G2).

## The CONVERGE flow (after GROUND is ratified + advanced)

CONVERGE turns the grounded-intent into ONE evidence-backed decision via two independent decisions, a conditional tiebreak, and a decision-ledger.

1. **Shortlist** — invoke `superpowers:brainstorming` to refine/synthesize G1's option-space into 1–3 serious candidates. `jam converge shortlist --file {options:[...]}`. Present to the human: **`jam approve CONVERGE-shortlist`** before spikes.
2. **Two independent decisions** (after shortlist approved): Claude and Codex each pick ONE candidate + justify it against every dimension. Codex runs **feasibility spikes** on the riskiest dimensions via `jam codex-run` (transcripts are the evidence; consequential commands go through `jam propose-action`/`ratify`). Record each: `jam converge decide --agent <claude|codex> --file {chosen, rationale, spikes:[...]}`.
3. **Cross-examine** — invoke `superpowers:verification-before-completion`; each attacks the other's choice.
4. **Tiebreak (only if they disagree)** — `jam converge tiebreak --choose <option>`.
5. **Finalize** — build the decision-ledger covering EVERY dimension. `satisfied` requires a registered, real spike transcript (`evidenceRef` listed in `spikes[]`); `unmet` requires `accepted:true`; every G1 open-unknown must be in `acceptedUnknowns`. `jam converge finalize --file {ledger:[...], spikes:[...], acceptedUnknowns:[...]}` → `CONVERGE` flips to `decided`. Any later change re-arms the gate.
6. **Ratify** — **`jam approve CONVERGE`**, then `jam advance` (reports `SPECIFY` ships in G3).

## The SPECIFY flow (after CONVERGE is ratified + advanced)

SPECIFY authors the project's GLOBAL `verifyCmd` as a human-ratified SSOT, proven un-gameable.

1. **Author the acceptance suite** — invoke `superpowers:test-driven-development`. Claude+Codex write the executable acceptance tests/validators/fixtures (the spec-as-tests) + the `verifyCmd` that runs them, and map every G2 acceptance dimension to ≥1 check. `jam specify coverage --file {verifyCmd, checks:[{id, dimension, ref}]}`. Present to the human: **`jam approve SPECIFY-coverage`** before the audit.
2. **Red-first** — `jam specify redproof` runs the verifyCmd on the un-built project; it MUST exit non-zero (a verifyCmd that already passes tests nothing).
3. **Gameability audit** — invoke `superpowers:verification-before-completion`; Codex (independent) attacks each check (hollow? tautological? can verifyCmd pass without the goal?) and returns a verdict. `jam specify gameability --file {reviewer:"codex", author:"claude", survivingFindings, findings:[...]}`. A surviving finding means fix the suite (re-`coverage`, which re-arms) and re-audit.
4. **Certify** — `jam specify certify` flips SPECIFY to `specified` only if coverage-approved, every dimension covered, red-first non-zero, and zero surviving findings.
5. **Ratify the SSOT** — **`jam approve SPECIFY`**, then `jam advance` enters BUILD. The certified verifyCmd is the SSOT the build will be gated by. Editing the suite after certify re-arms the gate.

## The BUILD flow (after SPECIFY's verifyCmd SSOT is ratified + advanced)

BUILD builds the project to the certified bar, reusing the repair sprint loop. The verifyCmd is LOCKED to the SSOT.

1. **Decompose** — invoke `superpowers:writing-plans`. Break the build into sprints tied to the decision + the SSOT's checks. `jam build plan --file {sprints:[{id,title,acceptanceCriteria,needs}]}` (verifyCmd is auto-locked to the certified SSOT — you cannot change it). Present to the human: **`jam approve BUILD-plan`**.
2. **Build each sprint** (dependency-ordered) — the SAME gated loop as repair: `jam sprint <id> --start`; `jam codex-run --sprint <id>` (runs in an isolated worktree; Codex builds; role-binding); `jam reconcile --sprint <id>` (lands the completed isolated turn in the main tree; a timed-out turn is reconciled, not lost, once complete); `jam sprint <id> --verify` (runs the locked SSOT verifyCmd; passes only on exit 0); `jam sprint <id> --done` (refuses unless verified AND Codex-authored). Any irreversible action still goes through `jam propose-action`/`ratify` (G0).
3. **Finish** — when every sprint is done, `jam advance` runs the run-honesty audit over the whole greenfield run and reaches **FINISH**. The project is built to exactly the certified bar. FINISH re-runs the certified `verifyCmd` against the live tree (not just historical evidence), and each sprint's Codex authorship is content-bound to its rollout's `session_meta` id.

## Status
`jam status` shows the active greenfield phase, current gates, and phase-specific artifacts including grounding, convergence, specification, and BUILD sprints.
