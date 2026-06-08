---
name: jam-prompting
description: Use to write the structured Codex prompt for a jam build or diagnosis pass — the "better than I'd write it" prompt that tells Codex exactly what to do, instructs it to use its own superpowers skills, and demands exact evidence back.
---

# jam prompting

Prompt text for both Codex passes is produced by `lib/prompting.mjs`. Use those functions — do not write ad-hoc prompt strings.

## Functions

**`buildGroundingPrompt({ goal, repoFacts, directives })`**
Produces the prompt for the DIAGNOSE grounding pass (`/codex:rescue`). It:
- Instructs Codex to use its `superpowers:systematic-debugging` skill — find the ROOT CAUSE before proposing any fix.
- Injects the acceptance goal and repo facts.
- Renders all `status: "active"` steering directives from the `directives` array so Codex honors them.
- Demands a specific deliverable: global state-map, root cause(s) of the local-pass/global-break gap, a prioritized fix-plan tagged global-structural vs local-patch, citing files/lines and validator evidence. No local patches.

**`buildAdversarialPrompt({ diagnosis, goal })`**
Produces the prompt for the VERIFY adversarial pass (`/codex:adversarial-review`). It:
- Instructs Codex to use its `superpowers:verification-before-completion` skill — REFUTE the diagnosis against source, not nitpick wording.
- Injects the acceptance goal and the full diagnosis text to refute.
- Demands a verdict with `unresolvedBlockers` set > 0 if the diagnosis is not safe to plan from, plus the missed failure mode.

## Usage pattern

```js
import { buildGroundingPrompt, buildAdversarialPrompt } from "./lib/prompting.mjs";

// DIAGNOSE pass — feed to /codex:rescue --background
const groundingText = buildGroundingPrompt({ goal, repoFacts, directives });

// VERIFY pass — feed to /codex:adversarial-review --background
const adversarialText = buildAdversarialPrompt({ diagnosis, goal });
```

## Steering directives

Any active steering directive recorded via `jam steer` is passed in the `directives` array to `buildGroundingPrompt`. The function filters for `status: "active"` entries and appends them to the prompt. Directives do not automatically flow into `buildAdversarialPrompt` (the adversarial pass is intentionally scoped to refuting the diagnosis, not re-adjudicating steering). If a directive materially changes the scope of the diagnosis, revise the diagnosis and re-run the grounding pass.

## Sprint prompts (future)

For PLAN/IMPLEMENT sprint prompts (Slice 2b-2), the same principles apply: state exact scope + acceptance criteria from `plan.md`, instruct Codex to use TDD superpowers skills, carry active directives, and demand exact evidence back (commands run, exit codes, diff, test output). A `buildSprintPrompt` function will be added to `lib/prompting.mjs` in that slice.
