import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { createRun, recordDigest, recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";

const HOOK = fileURLToPath(new URL("../plugins/jam/scripts/gate-hook.mjs", import.meta.url));

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jam-hook-"));
}
function validDigest() {
  return {
    runId: "r1", phase: "ALIGN", summary: "s",
    traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
    decisions: [],
    globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false },
    coverage: { addressed: [], dropped: [] }
  };
}
function runHook(cwd) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd }),
    encoding: "utf8"
  });
}

test("hook allows (no output) when there is no active run", () => {
  const r = runHook(tmpProject());
  assert.equal(r.stdout.trim(), "");
});

test("hook BLOCKS when the active run's ALIGN gate is unsatisfied", () => {
  const root = tmpProject();
  createRun({ projectRoot: root, runId: "r1", now: "t0" });
  const r = runHook(root);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.decision, "block");
  assert.match(payload.reason, /jam:approve ALIGN/);
});

test("hook ALLOWS once the gate is rendered + approved", () => {
  const root = tmpProject();
  const dir = createRun({ projectRoot: root, runId: "r1", now: "t0" });
  recordDigest({ runDir: dir, gateId: "ALIGN", digest: validDigest(), now: "t1" });
  recordApproval({ runDir: dir, gateId: "ALIGN", who: "neel", now: "t2" });
  const r = runHook(root);
  assert.equal(r.stdout.trim(), "");
});
