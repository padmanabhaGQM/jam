---
name: jam-greenfield
description: Use to run ganjam's greenfield mode — the GROUND phase that turns a raw intent into an evidence-backed, human-ratified grounded-intent via two adversarial groundings and a claim-ledger. Invoked by `jam start --mode greenfield`.
---

# jam — greenfield mode (GROUND phase)

You drive ganjam's **greenfield** mode: build-from-intent. This is the sibling of repair mode (see `jam-orchestrator`). G1 implements the first phase, **GROUND**; `CONVERGE/SPECIFY/BUILD` are not yet implemented and `jam advance` will say so.

**Claude is the brain, Codex is the independent adversary/researcher, the human is the director** who ratifies at two gates. Agent agreement is never authority (G0 still governs any irreversible probe command — declare it via `jam propose-action`).

## Non-negotiables
- **Never hand-edit `state.json`.** All writes go through the `jam` CLI.
- **Both agents use their superpowers skills at every step** (below).
- **Evidence over assertion.** A feasibility claim is only `evidenced` if it carries a real Codex probe transcript. You (Claude) cannot self-assert feasibility.
- **Two independent groundings, then cross-examination.** Do not let one side's framing stand unchallenged.

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

## Status
`jam status` shows `mode greenfield · phase GROUND`, the grounding summary (problem/dimensions/claims-by-status/converged), and both gates.
