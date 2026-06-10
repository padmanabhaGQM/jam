import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { sharpenIntent } from "../plugins/jam/scripts/lib/grounding.mjs";

function gfRun() { return createRun({ projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "jam-gscope-")), runId: "r1", mode: "greenfield", now: "t0" }); }

test("sharpenIntent records problem+dimensions and flips GROUND-scope to scoped", () => {
  const dir = gfRun();
  sharpenIntent({ runDir: dir, problem: "Translate video to dubbed audio", dimensions: ["WER < 5%", "speaker-preserved"], now: "t1" });
  const s = readState(dir);
  assert.equal(s.grounding.problem, "Translate video to dubbed audio");
  assert.deepEqual(s.grounding.dimensions, ["WER < 5%", "speaker-preserved"]);
  assert.equal(s.gates["GROUND-scope"].status, "scoped");
  assert.ok(readLedger(dir).some((e) => e.type === "intent-sharpened"));
});

test("once scoped, the human can approve GROUND-scope (mechanism-bound)", () => {
  const dir = gfRun();
  sharpenIntent({ runDir: dir, problem: "p", dimensions: ["d"], now: "t1" });
  recordApproval({ runDir: dir, gateId: "GROUND-scope", who: "user", now: "t2" });
  assert.equal(readState(dir).gates["GROUND-scope"].status, "approved");
});

test("sharpenIntent requires a non-empty problem and at least one dimension", () => {
  const dir = gfRun();
  assert.throws(() => sharpenIntent({ runDir: dir, problem: "", dimensions: ["d"] }), /problem/);
  assert.throws(() => sharpenIntent({ runDir: dir, problem: "p", dimensions: [] }), /dimension/);
});

test("GROUND-scope cannot be approved before it is scoped (still pending)", () => {
  const dir = gfRun();
  assert.throws(() => recordApproval({ runDir: dir, gateId: "GROUND-scope", who: "user" }), /not .*scoped|status=pending/);
});
