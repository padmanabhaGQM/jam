import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";
import { readState, validateState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { addClaim, refuteClaim } from "../plugins/jam/scripts/lib/grounding.mjs";

function gfRun() { return createRun({ projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "jam-gclaim-")), runId: "r1", mode: "greenfield", now: "t0" }); }

test("addClaim appends a framing claim and ledgers it", () => {
  const dir = gfRun();
  addClaim({ runDir: dir, id: "c1", text: "Whisper handles the languages we need", kind: "framing", status: "evidenced", source: "codex", now: "t1" });
  const s = readState(dir);
  assert.equal(s.grounding.claims[0].id, "c1");
  assert.equal(s.grounding.claims[0].status, "evidenced");
  assert.ok(readLedger(dir).some((e) => e.type === "claim-evidenced" && e.id === "c1"));
});

test("a feasibility claim REQUIRES an evidenceRef transcript that exists on disk", () => {
  const dir = gfRun();
  assert.throws(() => addClaim({ runDir: dir, id: "f1", text: "VAD runs at 30x realtime", kind: "feasibility", status: "evidenced", source: "codex" }), /feasibility .* evidenceRef/);
  assert.throws(() => addClaim({ runDir: dir, id: "f1", text: "x", kind: "feasibility", status: "evidenced", source: "codex", evidenceRef: "/no/such/transcript.jsonl" }), /transcript .* not found|does not exist/);
  const tr = path.join(dir, "probe-f1.jsonl");
  fs.writeFileSync(tr, "{}\n");
  addClaim({ runDir: dir, id: "f1", text: "x", kind: "feasibility", status: "evidenced", source: "codex", evidenceRef: tr });
  assert.equal(readState(dir).grounding.claims.find((c) => c.id === "f1").evidenceRef, tr);
});

test("a feasibility claim that is open-unknown does NOT need a transcript", () => {
  const dir = gfRun();
  addClaim({ runDir: dir, id: "u1", text: "Diarization accuracy unknown for overlapping speech", kind: "feasibility", status: "open-unknown", source: "both" });
  assert.equal(readState(dir).grounding.claims.find((c) => c.id === "u1").status, "open-unknown");
});

test("addClaim rejects bad kind/status/source and duplicate ids", () => {
  const dir = gfRun();
  assert.throws(() => addClaim({ runDir: dir, id: "c1", text: "x", kind: "bogus", status: "evidenced", source: "codex" }), /kind/);
  assert.throws(() => addClaim({ runDir: dir, id: "c1", text: "x", kind: "framing", status: "refuted", source: "codex" }), /status/);
  addClaim({ runDir: dir, id: "c1", text: "x", kind: "framing", status: "evidenced", source: "codex" });
  assert.throws(() => addClaim({ runDir: dir, id: "c1", text: "y", kind: "framing", status: "evidenced", source: "codex" }), /already exists/);
});

test("refuteClaim drops the claim entirely and ledgers it", () => {
  const dir = gfRun();
  addClaim({ runDir: dir, id: "c1", text: "x", kind: "framing", status: "evidenced", source: "claude" });
  refuteClaim({ runDir: dir, id: "c1", now: "t2" });
  assert.equal(readState(dir).grounding.claims.length, 0);
  assert.ok(readLedger(dir).some((e) => e.type === "claim-refuted" && e.id === "c1"));
});

test("validateState checks claim shape", () => {
  const dir = gfRun();
  const s = readState(dir);
  s.grounding.claims = [{ id: "c1", text: "x", kind: "framing", status: "evidenced", source: "codex" }];
  assert.equal(validateState(s).length, 0);
  s.grounding.claims = [{ id: "c2", kind: "framing", status: "evidenced", source: "codex" }];
  assert.ok(validateState(s).some((e) => /claim/.test(e)));
});
