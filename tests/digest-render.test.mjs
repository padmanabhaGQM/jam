import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDigest } from "../plugins/jam/scripts/lib/digest.mjs";

function d(extra = {}) {
  return { phase: "DIAGNOSE", summary: "diagnosed the spine",
    traceToArchitecture: { componentsTouched: ["scene_generator.py:577"], gapFromAgreed: null },
    decisions: [{ choice: "wire gate F1a", alternatives: ["new plan"], why: "infra exists" }],
    globalMap: { mermaid: "flowchart TD; LOOP-->GP", currentPosition: "ALIGN", isLocallyScopedRisk: false },
    coverage: { addressed: ["state-map"], dropped: ["live run"] }, ...extra };
}

test("render includes summary, components, mermaid, decisions, coverage", () => {
  const out = renderDigest(d());
  assert.match(out, /diagnosed the spine/);
  assert.match(out, /scene_generator\.py:577/);
  assert.match(out, /```mermaid/);
  assert.match(out, /wire gate F1a/);
  assert.match(out, /state-map/);
  assert.match(out, /live run/);
});

test("render flags a local-hack risk", () => {
  const out = renderDigest(d({ globalMap: { mermaid: "x", currentPosition: "p", isLocallyScopedRisk: true } }));
  assert.match(out, /LOCAL-HACK RISK/);
});

test("render is safe on a non-object", () => {
  assert.equal(typeof renderDigest(null), "string");
});
