import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { createRun, addGate, recordDigest, recordApproval, recordEvidence } from "../plugins/jam/scripts/lib/actions.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";

const HOOK = fileURLToPath(new URL("../plugins/jam/scripts/gate-hook.mjs", import.meta.url));

function tmpProject() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-e2e-")); }
function hookBlocks(cwd) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd }), encoding: "utf8" });
  return r.stdout.trim().length > 0;
}
function digest() {
  return {
    runId: "r1", phase: "ALIGN", summary: "s",
    traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
    decisions: [],
    globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false },
    coverage: { addressed: [], dropped: [] }
  };
}

test("a run cannot advance past gates without real preconditions; ledger reconstructs it", () => {
  const root = tmpProject();
  const dir = createRun({ projectRoot: root, runId: "r1", now: "t0" });

  // ALIGN gate: blocked at first.
  assert.equal(hookBlocks(root), true);
  // Cannot fake approval before the digest is rendered.
  assert.throws(() => recordApproval({ runDir: dir, gateId: "ALIGN", now: "t1" }), /digest not rendered/);
  // Render then approve — now ALIGN passes.
  recordDigest({ runDir: dir, gateId: "ALIGN", digest: digest(), now: "t2" });
  recordApproval({ runDir: dir, gateId: "ALIGN", who: "neel", now: "t3" });
  assert.equal(hookBlocks(root), false);

  // Add a sprint evidence gate — blocks again until exit-0 evidence.
  addGate({ runDir: dir, gateId: "sprint-0-evidence", mode: "auto", now: "t4" });
  assert.equal(hookBlocks(root), true);
  recordEvidence({ runDir: dir, gateId: "sprint-0-evidence", sprintId: "sprint-0", command: "exit 1", cwd: root, now: "t5" });
  assert.equal(hookBlocks(root), true); // failing verification does NOT pass the gate
  recordEvidence({ runDir: dir, gateId: "sprint-0-evidence", sprintId: "sprint-0", command: "exit 0", cwd: root, now: "t6" });
  assert.equal(hookBlocks(root), false);

  // The ledger is a complete, model-independent audit trail.
  const types = readLedger(dir).map((e) => e.type);
  assert.deepEqual(types, ["run-created", "digest-rendered", "approval", "gate-added", "evidence", "evidence"]);
});
