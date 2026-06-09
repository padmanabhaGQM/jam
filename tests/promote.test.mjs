import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";
import { readState, writeState, validateState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { promoteSprint } from "../plugins/jam/scripts/lib/plan.mjs";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-promote-")); }
function runAtImplement() {
  const dir = createRun({ projectRoot: tmp(), runId: "r1", mode: "repair", now: "t" });
  const s = readState(dir);
  s.phase = "IMPLEMENT";
  s.plan = { verifyCmd: "true", sprints: [{ id: "fix-1", title: "t", acceptanceCriteria: "ac", status: "pending", provenance: "planned" }] };
  writeState(dir, s);
  return dir;
}

test("promoteSprint adds a promoted sprint + a promotions decision + a ledger entry", () => {
  const dir = runAtImplement();
  promoteSprint({ runDir: dir, id: "fix-9", title: "discovered", reason: "found during fix-1", now: "t1" });
  const s = readState(dir);
  const sp = s.plan.sprints.find((x) => x.id === "fix-9");
  assert.equal(sp.provenance, "promoted");
  assert.equal(sp.status, "pending");
  assert.equal(s.promotions.length, 1);
  assert.deepEqual(s.promotions[0], { id: "fix-9", discoveredBy: "orchestrator", reason: "found during fix-1", decidedBy: "orchestrator", at: "t1" });
  assert.ok(readLedger(dir).some((e) => e.type === "sprint-promoted" && e.id === "fix-9"));
});

test("promoteSprint refuses off-IMPLEMENT, missing fields, and duplicate ids", () => {
  const dir = runAtImplement();
  assert.throws(() => promoteSprint({ runDir: dir, id: "x", title: "t" }), /reason/);
  assert.throws(() => promoteSprint({ runDir: dir, id: "fix-1", title: "t", reason: "r" }), /already exists/);
  const s = readState(dir); s.phase = "PLAN"; writeState(dir, s);
  assert.throws(() => promoteSprint({ runDir: dir, id: "y", title: "t", reason: "r" }), /not IMPLEMENT/);
});

test("validateState rejects invalid provenance and malformed promotions; accepts valid/absent", () => {
  const dir = runAtImplement();
  const s = readState(dir);
  assert.equal(validateState(s).length, 0);
  s.plan.sprints[0].provenance = "bogus";
  assert.ok(validateState(s).some((e) => /provenance/.test(e)));
  s.plan.sprints[0].provenance = "planned";
  s.promotions = [{ reason: "r" }];
  assert.ok(validateState(s).some((e) => /promotion/.test(e)));
});
