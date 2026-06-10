import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun, recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { readState, validateState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { sharpenIntent, addClaim, refuteClaim, convergeGrounding } from "../plugins/jam/scripts/lib/grounding.mjs";

function gfRun() { return createRun({ projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "jam-grearm-")), runId: "r1", mode: "greenfield", now: "t0" }); }
function scoped(dir) { sharpenIntent({ runDir: dir, problem: "p", dimensions: ["d"], now: "t1" }); recordApproval({ runDir: dir, gateId: "GROUND-scope", who: "user", now: "t2" }); }

test("BLOCKER FIX: adding a claim after convergence re-arms the GROUND gate", () => {
  const dir = gfRun(); scoped(dir);
  addClaim({ runDir: dir, id: "c1", text: "x", kind: "framing", status: "evidenced", source: "both" });
  convergeGrounding({ runDir: dir, now: "t3" });
  assert.equal(readState(dir).gates["GROUND"].status, "grounded");
  addClaim({ runDir: dir, id: "c2", text: "y", kind: "framing", status: "evidenced", source: "both", now: "t4" });
  const s = readState(dir);
  assert.equal(s.gates["GROUND"].status, "pending");
  assert.equal(s.grounding.converged, false);
  assert.ok(readLedger(dir).some((e) => e.type === "grounding-reopened"));
  assert.throws(() => recordApproval({ runDir: dir, gateId: "GROUND", who: "user" }), /grounded|status=pending/);
});

test("BLOCKER FIX: the post-converge refute+delete exploit no longer leaves GROUND approvable", () => {
  const dir = gfRun(); scoped(dir);
  const tr = path.join(dir, "p.jsonl"); fs.writeFileSync(tr, "{}\n");
  addClaim({ runDir: dir, id: "f1", text: "fast", kind: "feasibility", status: "evidenced", source: "codex", evidenceRef: tr });
  convergeGrounding({ runDir: dir, now: "t3" });
  fs.rmSync(tr);
  refuteClaim({ runDir: dir, id: "f1", now: "t4" });
  assert.equal(readState(dir).gates["GROUND"].status, "pending");
  assert.throws(() => recordApproval({ runDir: dir, gateId: "GROUND", who: "user" }), /grounded|status=pending/);
});

test("BLOCKER FIX: a claim mutation invalidates an ALREADY-APPROVED GROUND gate", () => {
  const dir = gfRun(); scoped(dir);
  addClaim({ runDir: dir, id: "c1", text: "x", kind: "framing", status: "evidenced", source: "both" });
  convergeGrounding({ runDir: dir, now: "t3" });
  recordApproval({ runDir: dir, gateId: "GROUND", who: "user", now: "t4" });
  assert.equal(readState(dir).gates["GROUND"].status, "approved");
  addClaim({ runDir: dir, id: "c2", text: "y", kind: "framing", status: "evidenced", source: "both", now: "t5" });
  assert.equal(readState(dir).gates["GROUND"].status, "pending");
});

test("validateState rejects an evidenced feasibility claim with no evidenceRef (forgery guard)", () => {
  const dir = gfRun();
  const s = readState(dir);
  s.grounding.claims = [{ id: "f1", text: "x", kind: "feasibility", status: "evidenced", source: "codex", evidenceRef: null }];
  assert.ok(validateState(s).some((e) => /evidenceRef/.test(e)));
  s.grounding.claims = [{ id: "u1", text: "x", kind: "feasibility", status: "open-unknown", source: "both", evidenceRef: null }];
  assert.equal(validateState(s).length, 0);
});

test("approving GROUND/GROUND-scope early gives an honest greenfield message (not 'digest')", () => {
  const dir = gfRun();
  assert.throws(() => recordApproval({ runDir: dir, gateId: "GROUND-scope", who: "user" }), /scoped|jam ground sharpen/);
  sharpenIntent({ runDir: dir, problem: "p", dimensions: ["d"] });
  recordApproval({ runDir: dir, gateId: "GROUND-scope", who: "user" });
  assert.throws(() => recordApproval({ runDir: dir, gateId: "GROUND", who: "user" }), /converge|grounded/);
});

test("re-sharpen after approval ledgers a scope-reopened entry", () => {
  const dir = gfRun(); scoped(dir);
  sharpenIntent({ runDir: dir, problem: "p2", dimensions: ["d2"], now: "t3" });
  assert.equal(readState(dir).gates["GROUND-scope"].status, "scoped");
  assert.ok(readLedger(dir).some((e) => e.type === "scope-reopened"));
});
