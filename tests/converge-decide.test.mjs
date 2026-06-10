import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readState, validateState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { advanceRun } from "../plugins/jam/scripts/lib/phases.mjs";
import { setShortlist, recordDecision, ruleTiebreak, convergeDecision } from "../plugins/jam/scripts/lib/convergence.mjs";
import { atConverge } from "./helpers/converge.mjs";

function agreed(dims, openUnknowns) {
  const dir = atConverge(dims, openUnknowns);
  setShortlist({ runDir: dir, options: ["opt-A", "opt-B"], now: "t7" });
  recordApproval({ runDir: dir, gateId: "CONVERGE-shortlist", who: "u", now: "t8" });
  recordDecision({ runDir: dir, agent: "claude", chosen: "opt-A", now: "t9" });
  recordDecision({ runDir: dir, agent: "codex", chosen: "opt-A", now: "t10" });
  return dir;
}
function spike(dir, name) { const p = path.join(dir, name); fs.writeFileSync(p, "{}\n"); return p; }

test("convergeDecision flips CONVERGE to 'decided' on a clean ledger; then human can approve", () => {
  const dir = agreed(["WER<5%", "latency"]);
  const tr = spike(dir, "s1.jsonl");
  convergeDecision({ runDir: dir, ledger: [
    { dimension: "WER<5%", status: "satisfied", rationale: "probe hit 4.2%", evidenceRef: tr },
    { dimension: "latency", status: "at-risk", rationale: "needs tuning", accepted: true },
  ], spikes: [{ id: "s1", dimension: "WER<5%", evidenceRef: tr }], now: "t11" });
  const s = readState(dir);
  assert.equal(s.convergence.decided, true);
  assert.equal(s.gates["CONVERGE"].status, "decided");
  assert.ok(readLedger(dir).some((e) => e.type === "convergence-decided"));
  recordApproval({ runDir: dir, gateId: "CONVERGE", who: "u", now: "t12" });
  assert.equal(readState(dir).gates["CONVERGE"].status, "approved");
});

test("KEY RED-TEAM: a missing dimension blocks 'decided'", () => {
  const dir = agreed(["WER<5%", "latency"]);
  const tr = spike(dir, "s1.jsonl");
  assert.throws(() => convergeDecision({ runDir: dir, ledger: [
    { dimension: "WER<5%", status: "satisfied", evidenceRef: tr },
  ], spikes: [{ id: "s1", dimension: "WER<5%", evidenceRef: tr }], now: "t11" }), /latency.*missing/);
  assert.notEqual(readState(dir).gates["CONVERGE"].status, "decided");
});

test("KEY RED-TEAM: 'satisfied' must reference a registered, real spike transcript; 'unmet' needs accepted", () => {
  const dir = agreed(["WER<5%"]);
  const tr = spike(dir, "s1.jsonl");
  // satisfied with evidenceRef NOT in spikes[] -> blocked
  assert.throws(() => convergeDecision({ runDir: dir, ledger: [
    { dimension: "WER<5%", status: "satisfied", evidenceRef: tr },
  ], spikes: [], now: "t11" }), /satisfied .* registered spike|not a registered/);
  // satisfied with a spike whose transcript was deleted -> blocked
  const tr2 = spike(dir, "s2.jsonl"); fs.rmSync(tr2);
  assert.throws(() => convergeDecision({ runDir: dir, ledger: [
    { dimension: "WER<5%", status: "satisfied", evidenceRef: tr2 },
  ], spikes: [{ id: "s2", evidenceRef: tr2 }], now: "t11" }), /transcript|locatable/);
  // unmet without accepted -> blocked
  assert.throws(() => convergeDecision({ runDir: dir, ledger: [
    { dimension: "WER<5%", status: "unmet" },
  ], spikes: [], now: "t11" }), /unmet.*accepted/);
});

test("KEY RED-TEAM: a G1 open-unknown must be carried into acceptedUnknowns before 'decided'", () => {
  const dir = agreed(["WER<5%"], ["scale beyond 1h untested"]);
  const tr = spike(dir, "s1.jsonl");
  const ledger = [{ dimension: "WER<5%", status: "satisfied", evidenceRef: tr }];
  const spikes = [{ id: "s1", dimension: "WER<5%", evidenceRef: tr }];
  assert.throws(() => convergeDecision({ runDir: dir, ledger, spikes, now: "t11" }), /open-unknown|acceptedUnknowns/);
  convergeDecision({ runDir: dir, ledger, spikes, acceptedUnknowns: ["scale beyond 1h untested"], now: "t12" });
  assert.equal(readState(dir).gates["CONVERGE"].status, "decided");
});

test("disagreement blocks 'decided' until the tiebreak is ruled", () => {
  const dir = atConverge(["WER<5%"]);
  setShortlist({ runDir: dir, options: ["opt-A", "opt-B"], now: "t7" });
  recordApproval({ runDir: dir, gateId: "CONVERGE-shortlist", who: "u", now: "t8" });
  recordDecision({ runDir: dir, agent: "claude", chosen: "opt-A", now: "t9" });
  recordDecision({ runDir: dir, agent: "codex", chosen: "opt-B", now: "t10" });
  const tr = spike(dir, "s1.jsonl");
  const ledger = [{ dimension: "WER<5%", status: "satisfied", evidenceRef: tr }];
  const spikes = [{ id: "s1", dimension: "WER<5%", evidenceRef: tr }];
  assert.throws(() => convergeDecision({ runDir: dir, ledger, spikes, now: "t11" }), /disagree|tiebreak/);
  ruleTiebreak({ runDir: dir, chosen: "opt-A", now: "t11b" });
  convergeDecision({ runDir: dir, ledger, spikes, now: "t12" });
  assert.equal(readState(dir).gates["CONVERGE"].status, "decided");
});

test("KEY RED-TEAM: re-arm — recording a decision after 'decided' resets CONVERGE to pending and clears the ledger", () => {
  const dir = agreed(["WER<5%"]);
  const tr = spike(dir, "s1.jsonl");
  convergeDecision({ runDir: dir, ledger: [{ dimension: "WER<5%", status: "satisfied", evidenceRef: tr }], spikes: [{ id: "s1", dimension: "WER<5%", evidenceRef: tr }], now: "t11" });
  assert.equal(readState(dir).gates["CONVERGE"].status, "decided");
  recordDecision({ runDir: dir, agent: "codex", chosen: "opt-B", now: "t12" });
  const s = readState(dir);
  assert.equal(s.gates["CONVERGE"].status, "pending");
  assert.equal(s.convergence.decided, false);
  assert.deepEqual(s.convergence.ledger, []);
});

test("after decided+approval, advancing hits the SPECIFY stub", () => {
  const dir = agreed(["WER<5%"]);
  const tr = spike(dir, "s1.jsonl");
  convergeDecision({ runDir: dir, ledger: [{ dimension: "WER<5%", status: "satisfied", evidenceRef: tr }], spikes: [{ id: "s1", dimension: "WER<5%", evidenceRef: tr }], now: "t11" });
  recordApproval({ runDir: dir, gateId: "CONVERGE", who: "u", now: "t12" });
  advanceRun({ runDir: dir, now: "t13" });
  assert.equal(readState(dir).phase, "SPECIFY");
});

test("validateState rejects a 'satisfied' row with no evidenceRef and unmet/at-risk rows without accepted", () => {
  const dir = agreed(["WER<5%"]);
  const s = readState(dir);
  s.convergence.ledger = [{ dimension: "WER<5%", status: "satisfied", evidenceRef: null }];
  assert.ok(validateState(s).some((e) => /evidenceRef/.test(e)));
  s.convergence.ledger = [{ dimension: "WER<5%", status: "unmet" }];
  assert.ok(validateState(s).some((e) => /accepted/.test(e)));
  s.convergence.ledger = [{ dimension: "WER<5%", status: "at-risk", rationale: "ok" }];
  assert.ok(validateState(s).some((e) => /accepted/.test(e)));
  s.convergence.ledger = [{ dimension: "WER<5%", status: "at-risk", rationale: "ok", accepted: true }];
  assert.equal(validateState(s).filter((e) => /ledger|evidenceRef|accepted/.test(e)).length, 0);
});

test("approving CONVERGE/CONVERGE-shortlist early gives an honest message (not 'digest not rendered')", () => {
  const dir = atConverge(["WER<5%"]);
  assert.throws(() => recordApproval({ runDir: dir, gateId: "CONVERGE-shortlist", who: "u" }), /shortlist|jam converge shortlist/);
  setShortlist({ runDir: dir, options: ["opt-A"] });
  recordApproval({ runDir: dir, gateId: "CONVERGE-shortlist", who: "u" });
  assert.throws(() => recordApproval({ runDir: dir, gateId: "CONVERGE", who: "u" }), /decided|jam converge finalize/);
});
