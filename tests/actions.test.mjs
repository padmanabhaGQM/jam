import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runDir, readActiveRunId } from "../plugins/jam/scripts/lib/paths.mjs";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import {
  createRun, addGate, recordDigest, recordApproval, recordEvidence
} from "../plugins/jam/scripts/lib/actions.mjs";

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jam-act-"));
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

test("createRun writes state, ACTIVE pointer, and a ledger entry", () => {
  const root = tmpProject();
  const dir = createRun({ projectRoot: root, runId: "r1", topic: "demo", now: "t0" });
  assert.equal(readActiveRunId(root), "r1");
  assert.equal(readState(dir).gates.ALIGN.status, "pending");
  assert.equal(readLedger(dir)[0].type, "run-created");
});

test("recordApproval THROWS on a human gate whose digest is not rendered (cannot bypass)", () => {
  const root = tmpProject();
  const dir = createRun({ projectRoot: root, runId: "r1", now: "t0" });
  assert.throws(
    () => recordApproval({ runDir: dir, gateId: "ALIGN", who: "neel", now: "t1" }),
    /digest not rendered/
  );
  assert.equal(readState(dir).gates.ALIGN.status, "pending");
});

test("render-then-approve is the only path to a passed human gate", () => {
  const root = tmpProject();
  const dir = createRun({ projectRoot: root, runId: "r1", now: "t0" });
  recordDigest({ runDir: dir, gateId: "ALIGN", digest: validDigest(), now: "t1" });
  assert.equal(readState(dir).gates.ALIGN.status, "rendered");
  recordApproval({ runDir: dir, gateId: "ALIGN", who: "neel", now: "t2" });
  const g = readState(dir).gates.ALIGN;
  assert.equal(g.status, "approved");
  assert.equal(g.approvedBy, "neel");
});

test("recordDigest THROWS on an invalid digest (missing detector)", () => {
  const root = tmpProject();
  const dir = createRun({ projectRoot: root, runId: "r1", now: "t0" });
  const bad = validDigest(); delete bad.globalMap;
  assert.throws(() => recordDigest({ runDir: dir, gateId: "ALIGN", digest: bad, now: "t1" }), /invalid digest/);
});

test("recordEvidence passes an auto gate ONLY on exit 0", () => {
  const root = tmpProject();
  const dir = createRun({ projectRoot: root, runId: "r1", now: "t0" });
  addGate({ runDir: dir, gateId: "sprint-0-evidence", mode: "auto", now: "t1" });

  recordEvidence({ runDir: dir, gateId: "sprint-0-evidence", sprintId: "sprint-0", command: "exit 1", cwd: root, now: "t2" });
  assert.equal(readState(dir).gates["sprint-0-evidence"].status, "pending");

  recordEvidence({ runDir: dir, gateId: "sprint-0-evidence", sprintId: "sprint-0", command: "exit 0", cwd: root, now: "t3" });
  assert.equal(readState(dir).gates["sprint-0-evidence"].status, "evidence-passed");
});

test("recordApproval refuses non-human (auto) gates", () => {
  const root = tmpProject();
  const dir = createRun({ projectRoot: root, runId: "r1", now: "t0" });
  addGate({ runDir: dir, gateId: "sprint-0-evidence", mode: "auto", now: "t1" });
  assert.throws(
    () => recordApproval({ runDir: dir, gateId: "sprint-0-evidence", now: "t2" }),
    /human gates/
  );
  assert.equal(readState(dir).gates["sprint-0-evidence"].status, "pending");
});

test("recordEvidence demotes a passed gate when a later run fails", () => {
  const root = tmpProject();
  const dir = createRun({ projectRoot: root, runId: "r1", now: "t0" });
  addGate({ runDir: dir, gateId: "g", mode: "auto", now: "t1" });
  recordEvidence({ runDir: dir, gateId: "g", sprintId: "s", command: "exit 0", cwd: root, now: "t2" });
  assert.equal(readState(dir).gates.g.status, "evidence-passed");
  recordEvidence({ runDir: dir, gateId: "g", sprintId: "s", command: "exit 1", cwd: root, now: "t3" });
  assert.equal(readState(dir).gates.g.status, "pending");
  assert.equal(readState(dir).gates.g.evidenceRef, null);
});

test("recordEvidence refuses non-auto (human) gates", () => {
  const root = tmpProject();
  const dir = createRun({ projectRoot: root, runId: "r1", now: "t0" });
  assert.throws(
    () => recordEvidence({ runDir: dir, gateId: "ALIGN", sprintId: "s", command: "exit 0", cwd: root, now: "t1" }),
    /auto gates/
  );
  assert.equal(readState(dir).gates.ALIGN.status, "pending");
});
