import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readState, validateState } from "../plugins/jam/scripts/lib/state.mjs";
import { recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { setShortlist, recordDecision, convergeDecision } from "../plugins/jam/scripts/lib/convergence.mjs";
import { atConverge } from "./helpers/converge.mjs";

function agreed(dims, openUnknowns) {
  const dir = atConverge(dims, openUnknowns);
  setShortlist({ runDir: dir, options: ["opt-A", "opt-B"], now: "t7" });
  recordApproval({ runDir: dir, gateId: "CONVERGE-shortlist", who: "u", now: "t8" });
  recordDecision({ runDir: dir, agent: "claude", chosen: "opt-A", now: "t9" });
  recordDecision({ runDir: dir, agent: "codex", chosen: "opt-A", now: "t10" });
  return dir;
}

function spike(dir, name) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, "{}\n");
  return p;
}

test("IMPORTANT: an 'at-risk' dimension must be accepted (no evidence-free escape hatch)", () => {
  const dir = agreed(["WER<5%"]);
  assert.throws(() => convergeDecision({ runDir: dir, ledger: [
    { dimension: "WER<5%", status: "at-risk", rationale: "hand-wave" },
  ], spikes: [], now: "t11" }), /at-risk .* accepted|accept the risk/);
  // accepted at-risk is allowed
  convergeDecision({ runDir: dir, ledger: [
    { dimension: "WER<5%", status: "at-risk", rationale: "tuning needed", accepted: true },
  ], spikes: [], now: "t12" });
  assert.equal(readState(dir).gates["CONVERGE"].status, "decided");
});

test("MINOR: a spike registered for a DIFFERENT dimension cannot satisfy this one", () => {
  const dir = agreed(["WER<5%", "latency"]);
  const tr = spike(dir, "s1.jsonl");
  assert.throws(() => convergeDecision({ runDir: dir, ledger: [
    { dimension: "WER<5%", status: "satisfied", evidenceRef: tr },
    { dimension: "latency", status: "satisfied", evidenceRef: tr },
  ], spikes: [{ id: "s1", dimension: "WER<5%", evidenceRef: tr }], now: "t11" }), /different dimension|registered for/);
});

test("MINOR: convergeDecision refuses when there are no acceptance dimensions", () => {
  const dir = agreed(["WER<5%"]);
  const s = readState(dir);
  s.grounding.dimensions = [];
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(s, null, 2));
  assert.throws(() => convergeDecision({ runDir: dir, ledger: [], spikes: [], now: "t11" }), /at least one acceptance dimension/);
});

test("MINOR: validateState rejects a CONVERGE gate decided/approved while convergence.decided is false", () => {
  const dir = agreed(["WER<5%"]);
  const s = readState(dir);
  s.gates["CONVERGE"].status = "decided";
  s.convergence.decided = false;
  assert.ok(validateState(s).some((e) => /decided/.test(e)));
});
