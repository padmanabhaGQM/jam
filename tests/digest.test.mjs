import { test } from "node:test";
import assert from "node:assert/strict";

import { validateDigest } from "../plugins/jam/scripts/lib/digest.mjs";

function validDigest() {
  return {
    runId: "r1",
    phase: "ALIGN",
    summary: "did a thing",
    traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
    decisions: [{ choice: "X", alternatives: ["Y"], why: "because" }],
    globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false },
    coverage: { addressed: ["c1"], dropped: [] }
  };
}

test("a full digest with all four detectors is valid", () => {
  assert.deepEqual(validateDigest(validDigest()), { valid: true, errors: [] });
});

test("missing trace-to-architecture is invalid", () => {
  const d = validDigest();
  delete d.traceToArchitecture;
  const r = validateDigest(d);
  assert.equal(r.valid, false);
  assert.match(r.errors.join(";"), /traceToArchitecture/);
});

test("missing global map is invalid", () => {
  const d = validDigest();
  delete d.globalMap;
  assert.equal(validateDigest(d).valid, false);
});

test("missing coverage delta is invalid", () => {
  const d = validDigest();
  delete d.coverage;
  assert.equal(validateDigest(d).valid, false);
});

test("non-object is invalid", () => {
  assert.equal(validateDigest(null).valid, false);
});
