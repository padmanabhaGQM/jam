---
name: jam-digest
description: Use to produce a jam intermediate-state digest — the glanceable supervision artifact (summary + flow + guide) that must expose all four drift-detectors before a gate can advance.
---

# jam digest

Digest validation and rendering is handled by `lib/digest.mjs`. Use those functions — do not produce ad-hoc digest output.

## Functions

**`validateDigest(digest)`**
Validates a digest object against the four-detector contract. Returns `{ valid: boolean, errors: string[] }`. A digest is valid only if it contains all four detectors in their required shapes:

| Detector | Required fields |
|---|---|
| **1. Trace to architecture** | `traceToArchitecture.componentsTouched` (string[]) |
| **2. Decision register** | `decisions[]` each with `choice`, `alternatives[]`, `why` |
| **3. Global project map** | `globalMap.mermaid` (string), `globalMap.currentPosition` (string), `globalMap.isLocallyScopedRisk` (boolean) |
| **4. Coverage delta** | `coverage.addressed` (string[]), `coverage.dropped` (string[]) |
| **Summary** | `summary` (string) |

Call `validateDigest` before passing the digest to `jam render-digest`.

**`renderDigest(digest)`**
Renders the digest as Markdown with Mermaid to the terminal. Sections:
1. Summary header (phase + sprint if present)
2. Trace to architecture — components touched; gap from agreed (if set)
3. Decisions — each choice vs alternatives + rationale
4. Global map — Mermaid diagram, current position, and a `LOCAL-HACK RISK` warning if `isLocallyScopedRisk: true`
5. Coverage — addressed vs dropped items

## Usage pattern

```js
import { validateDigest, renderDigest } from "./lib/digest.mjs";

const result = validateDigest(digest);
if (!result.valid) throw new Error(result.errors.join("; "));

console.log(renderDigest(digest));
// then record via CLI:
// jam render-digest DIAGNOSE --file <digest.json>
```

## The four detectors (what each catches)

1. **Trace to architecture** — surfaces which components a change touches and flags divergence from the agreed architecture. Prevents silent scope creep.
2. **Decision register** — exposes design choices before they're buried in code, giving the user a taste-veto before the choice is locked in.
3. **Global project map** — a Mermaid view of the whole system with current position highlighted. The `isLocallyScopedRisk` flag is **true when the fix is locally scoped** — i.e. it may pass local validators but leave the global system broken (the anti-spiral signal).
4. **Coverage delta** — what spec/plan items were addressed vs deliberately dropped in this step. Prevents silent omissions.

All four must be present and non-empty before a gate can be approved. `jam render-digest` enforces this via `validateDigest` before recording.
