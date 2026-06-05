---
name: jam-prompting
description: Use to write the structured Codex sprint prompt that drives a /codex:rescue build — the "better than I'd write it" prompt that tells Codex exactly what to implement, to use its own skills, and to return exact evidence.
---

> **Scaffold — not yet implemented.** Contract only; logic built next.

# jam prompting

Claude writes the structured prompt that drives each Codex build sprint (design spec §4, phase C step 1). A good sprint prompt:

- States the exact scope of *this* sprint and its acceptance criteria, drawn from `plan.md` coverage items.
- Explicitly instructs Codex to use its synced superpowers skills (e.g. TDD) — `/codex:rescue` is a thin forwarder, so Codex won't run them unless told (caveat C-1).
- Carries any active steering directives, with context.
- Demands exact evidence back: the commands run, exit codes, diff, and test output.
- Stays read/write-scoped appropriately (`--write` for build sprints).

May reuse the Codex plugin's `gpt-5-4-prompting` skill to tighten wording.
