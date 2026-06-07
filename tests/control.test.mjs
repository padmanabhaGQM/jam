import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { addSteering, cancelRun } from "../plugins/jam/scripts/lib/control.mjs";

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jam-ctl-"));
}

test("addSteering appends an active directive and a ledger entry", () => {
  const root = tmpProject();
  const dir = createRun({ projectRoot: root, runId: "r1", now: "t0" });
  const d = addSteering({ runDir: dir, text: "use the existing auth module", context: "sprint 2", now: "t1" });
  assert.equal(d.id, "d1");
  assert.equal(d.status, "active");
  assert.equal(d.text, "use the existing auth module");
  const state = readState(dir);
  assert.equal(state.steeringDirectives.length, 1);
  assert.equal(state.steeringDirectives[0].id, "d1");
  assert.equal(readLedger(dir).at(-1).type, "steering");
});

test("addSteering ids increment", () => {
  const root = tmpProject();
  const dir = createRun({ projectRoot: root, runId: "r1", now: "t0" });
  addSteering({ runDir: dir, text: "one", now: "t1" });
  const d2 = addSteering({ runDir: dir, text: "two", now: "t2" });
  assert.equal(d2.id, "d2");
});

test("addSteering rejects empty text", () => {
  const root = tmpProject();
  const dir = createRun({ projectRoot: root, runId: "r1", now: "t0" });
  assert.throws(() => addSteering({ runDir: dir, text: "  ", now: "t1" }), /text required/);
});

import { readActiveRunId, activePointerPath } from "../plugins/jam/scripts/lib/paths.mjs";

test("cancelRun clears the ACTIVE pointer and records a ledger entry", () => {
  const root = tmpProject();
  const dir = createRun({ projectRoot: root, runId: "r1", now: "t0" });
  assert.equal(readActiveRunId(root), "r1");
  cancelRun({ projectRoot: root, runDir: dir, now: "t1" });
  assert.equal(readActiveRunId(root), null);
  assert.equal(fs.existsSync(activePointerPath(root)), false);
  assert.equal(readLedger(dir).at(-1).type, "cancelled");
});

test("cancelRun is safe when ACTIVE pointer already absent", () => {
  const root = tmpProject();
  const dir = createRun({ projectRoot: root, runId: "r1", now: "t0" });
  fs.rmSync(activePointerPath(root));
  assert.doesNotThrow(() => cancelRun({ projectRoot: root, runDir: dir, now: "t1" }));
});
