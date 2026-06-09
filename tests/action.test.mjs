import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun, recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { readState, validateState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { proposeAction, ratifyAction } from "../plugins/jam/scripts/lib/action.mjs";

function run() { return createRun({ projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "jam-g0-")), runId: "r1", mode: "repair", now: "t" }); }

test("proposeAction: irreversible → action + hard-block gate; reversible → allowed, no gate", () => {
  const dir = run();
  const r = proposeAction({ runDir: dir, id: "del-1", type: "delete-path", target: "src/", now: "t1" });
  assert.equal(r.irreversible, true);
  const s = readState(dir);
  assert.equal(s.actions.find((a) => a.id === "del-1").status, "proposed");
  assert.equal(s.gates["action-del-1"].mode, "human");
  assert.equal(s.gates["action-del-1"].approveFrom, "ratified");
  proposeAction({ runDir: dir, id: "ok-1", type: "edit-file", target: "x.js", now: "t2" });
  const s2 = readState(dir);
  assert.equal(s2.actions.find((a) => a.id === "ok-1").status, "allowed");
  assert.equal(s2.gates["action-ok-1"], undefined);
});

test("proposeAction refuses a duplicate id", () => {
  const dir = run();
  proposeAction({ runDir: dir, id: "del-1", type: "delete-path", now: "t1" });
  assert.throws(() => proposeAction({ runDir: dir, id: "del-1", type: "delete-path" }), /already exists/);
});

test("ratifyAction: matching confirm → ratified; wrong → throws; deny → denied", () => {
  const dir = run();
  proposeAction({ runDir: dir, id: "del-1", type: "delete-path", now: "t1" });
  assert.throws(() => ratifyAction({ runDir: dir, id: "del-1", confirm: "nope" }), /does not match/);
  ratifyAction({ runDir: dir, id: "del-1", confirm: "del-1", now: "t2" });
  assert.equal(readState(dir).gates["action-del-1"].status, "ratified");
  assert.ok(readLedger(dir).some((e) => e.type === "action-ratified" && e.id === "del-1"));
  proposeAction({ runDir: dir, id: "del-2", type: "db-drop", now: "t3" });
  ratifyAction({ runDir: dir, id: "del-2", deny: true, now: "t4" });
  assert.equal(readState(dir).actions.find((a) => a.id === "del-2").status, "denied");
  assert.equal(readState(dir).gates["action-del-2"].status, "rejected");
});

test("ratifyAction throws on unknown or reversible action", () => {
  const dir = run();
  assert.throws(() => ratifyAction({ runDir: dir, id: "nope", confirm: "nope" }), /unknown action/);
  proposeAction({ runDir: dir, id: "ok-1", type: "edit-file", now: "t1" });
  assert.throws(() => ratifyAction({ runDir: dir, id: "ok-1", confirm: "ok-1" }), /reversible/);
});

test("validateState value-checks actions; ratified is a valid gate status", () => {
  const dir = run();
  const s = readState(dir);
  s.actions = [{ id: "a", type: "delete-path", irreversible: true, reasons: [], status: "proposed", at: "t" }];
  s.gates["action-a"] = { mode: "human", status: "ratified", approveFrom: "ratified" };
  assert.equal(validateState(s).length, 0);
  s.actions = [{ type: "x", irreversible: true }];
  assert.ok(validateState(s).some((e) => /action/.test(e)));
  s.actions = "nope";
  assert.ok(validateState(s).some((e) => /actions must be an array/.test(e)));
});

test("an irreversible action gate cannot be opened by /jam:approve, and the refusal names ratify (honest message)", () => {
  const dir = run();
  proposeAction({ runDir: dir, id: "del-1", type: "delete-path", now: "t1" });
  assert.throws(
    () => recordApproval({ runDir: dir, gateId: "action-del-1", who: "user", now: "t2" }),
    /not ratified|jam ratify/,
  );
});
