import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { setShortlist } from "../plugins/jam/scripts/lib/convergence.mjs";
import { atConverge } from "./helpers/converge.mjs";

test("setShortlist records 1-3 candidates and flips CONVERGE-shortlist to shortlisted", () => {
  const dir = atConverge();
  setShortlist({ runDir: dir, options: ["stems-then-whisper", "e2e-dub-model"], now: "t7" });
  const s = readState(dir);
  assert.deepEqual(s.convergence.shortlist, ["stems-then-whisper", "e2e-dub-model"]);
  assert.equal(s.gates["CONVERGE-shortlist"].status, "shortlisted");
  assert.ok(readLedger(dir).some((e) => e.type === "shortlist-set"));
  recordApproval({ runDir: dir, gateId: "CONVERGE-shortlist", who: "u", now: "t8" });
  assert.equal(readState(dir).gates["CONVERGE-shortlist"].status, "approved");
});

test("setShortlist rejects empty, >3, and duplicate candidates", () => {
  const dir = atConverge();
  assert.throws(() => setShortlist({ runDir: dir, options: [] }), /at least one/);
  assert.throws(() => setShortlist({ runDir: dir, options: ["a", "b", "c", "d"] }), /at most 3/);
  assert.throws(() => setShortlist({ runDir: dir, options: ["a", "a"] }), /duplicate/);
});

test("setShortlist refuses outside the CONVERGE phase", () => {
  const dir = atConverge();
  const sp = path.join(dir, "state.json");
  const s = JSON.parse(fs.readFileSync(sp, "utf8"));
  s.phase = "GROUND";
  fs.writeFileSync(sp, JSON.stringify(s, null, 2));
  assert.throws(() => setShortlist({ runDir: dir, options: ["a"] }), /CONVERGE phase/);
});
