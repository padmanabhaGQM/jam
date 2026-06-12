import { test } from "node:test";
import assert from "node:assert/strict";

import { createInitialState, addGate } from "../plugins/jam/scripts/lib/state.mjs";
import { evaluateGate, currentBlockingGate } from "../plugins/jam/scripts/lib/gate.mjs";

test("human gate blocks until approved", () => {
  const s = createInitialState({ runId: "r1", now: "t" });
  assert.equal(evaluateGate(s, "ALIGN").allowed, false);
  s.gates.ALIGN.status = "rendered";
  assert.equal(evaluateGate(s, "ALIGN").allowed, false);
  s.gates.ALIGN.status = "approved";
  assert.equal(evaluateGate(s, "ALIGN").allowed, true);
});

test("auto gate blocks until evidence-passed", () => {
  const s = createInitialState({ runId: "r1", now: "t" });
  addGate(s, "sprint-0-evidence", "auto");
  assert.equal(evaluateGate(s, "sprint-0-evidence").allowed, false);
  s.gates["sprint-0-evidence"].status = "evidence-passed";
  assert.equal(evaluateGate(s, "sprint-0-evidence").allowed, true);
});

test("unknown gate is not allowed", () => {
  const s = createInitialState({ runId: "r1", now: "t" });
  assert.equal(evaluateGate(s, "ghost").allowed, false);
});

test("human block reason names the approve command", () => {
  const s = createInitialState({ runId: "r1", now: "t" });
  s.gates.ALIGN.status = "rendered";
  const reason = evaluateGate(s, "ALIGN").reason;
  assert.match(reason, /jam approve ALIGN/);
  assert.doesNotMatch(reason, /\/jam:/);
});

test("currentBlockingGate returns first unsatisfied gate, null when all satisfied", () => {
  const s = createInitialState({ runId: "r1", now: "t" });
  assert.equal(currentBlockingGate(s), "ALIGN");
  s.gates.ALIGN.status = "approved";
  assert.equal(currentBlockingGate(s), null);
});
