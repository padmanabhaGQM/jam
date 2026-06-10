import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun, recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { advanceRun } from "../plugins/jam/scripts/lib/phases.mjs";
import { sharpenIntent, addClaim, convergeGrounding } from "../plugins/jam/scripts/lib/grounding.mjs";

function gfRun() { return createRun({ projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "jam-gconv-")), runId: "r1", mode: "greenfield", now: "t0" }); }
function scoped(dir) { sharpenIntent({ runDir: dir, problem: "p", dimensions: ["d"], now: "t1" }); recordApproval({ runDir: dir, gateId: "GROUND-scope", who: "user", now: "t2" }); }

test("convergeGrounding requires GROUND-scope approved first", () => {
  const dir = gfRun();
  sharpenIntent({ runDir: dir, problem: "p", dimensions: ["d"], now: "t1" });   // scoped but NOT approved
  assert.throws(() => convergeGrounding({ runDir: dir }), /scope .* approved|GROUND-scope/);
});

test("a clean ledger converges: GROUND flips to 'grounded', then a human can approve it", () => {
  const dir = gfRun(); scoped(dir);
  addClaim({ runDir: dir, id: "c1", text: "framing claim", kind: "framing", status: "evidenced", source: "both" });
  addClaim({ runDir: dir, id: "u1", text: "an open risk", kind: "feasibility", status: "open-unknown", source: "both" });
  convergeGrounding({ runDir: dir, options: [{ name: "opt-A", priorArt: "x", tradeoffs: "y" }], openUnknowns: ["scale untested"], now: "t3" });
  const s = readState(dir);
  assert.equal(s.grounding.converged, true);
  assert.deepEqual(s.grounding.openUnknowns, ["scale untested"]);
  assert.equal(s.gates["GROUND"].status, "grounded");
  assert.ok(readLedger(dir).some((e) => e.type === "grounding-converged"));
  recordApproval({ runDir: dir, gateId: "GROUND", who: "user", now: "t4" });
  assert.equal(readState(dir).gates["GROUND"].status, "approved");
});

test("KEY RED-TEAM: a feasibility claim whose transcript vanished blocks convergence", () => {
  const dir = gfRun(); scoped(dir);
  const tr = path.join(dir, "probe-f1.jsonl"); fs.writeFileSync(tr, "{}\n");
  addClaim({ runDir: dir, id: "f1", text: "fast enough", kind: "feasibility", status: "evidenced", source: "codex", evidenceRef: tr });
  fs.rmSync(tr);
  assert.throws(() => convergeGrounding({ runDir: dir }), /f1 .* transcript|evidence .* not found/);
  assert.notEqual(readState(dir).gates["GROUND"].status, "grounded");
});

test("KEY RED-TEAM: /jam:approve cannot open GROUND before convergence flips it to 'grounded'", () => {
  const dir = gfRun(); scoped(dir);
  assert.throws(() => recordApproval({ runDir: dir, gateId: "GROUND", who: "user" }), /status=pending|grounded/);
});

test("convergence with no problem set is refused", () => {
  const dir = gfRun();
  const s = readState(dir);
  s.gates["GROUND-scope"].status = "approved";
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(s, null, 2));
  assert.throws(() => convergeGrounding({ runDir: dir }), /problem/);
});

test("after convergence + approval, advancing GROUND -> CONVERGE now succeeds", () => {
  const dir = gfRun(); scoped(dir);
  addClaim({ runDir: dir, id: "c1", text: "x", kind: "framing", status: "evidenced", source: "both" });
  convergeGrounding({ runDir: dir, now: "t3" });
  recordApproval({ runDir: dir, gateId: "GROUND", who: "user", now: "t4" });
  advanceRun({ runDir: dir, now: "t5" });
  assert.equal(readState(dir).phase, "CONVERGE");
});
