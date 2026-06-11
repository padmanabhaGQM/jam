import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";
import { readState, writeState } from "../plugins/jam/scripts/lib/state.mjs";
import { appendLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { evaluateAudit, auditRun } from "../plugins/jam/scripts/lib/audit.mjs";

function goodLedger() {
  return [
    { type: "run-created", runId: "r1" },
    { type: "digest-rendered", gateId: "DIAGNOSE" },
    { type: "approval", gateId: "DIAGNOSE", who: "user" },
    { type: "phase-advanced", from: "DIAGNOSE", to: "VERIFY" },
    { type: "verification", gateId: "VERIFY", blockers: 0 },
    { type: "approval", gateId: "VERIFY", who: "user" },
    { type: "phase-advanced", from: "VERIFY", to: "PLAN" },
    { type: "plan-recorded", sprints: 1 },
    { type: "approval", gateId: "PLAN", who: "user" },
    { type: "phase-advanced", from: "PLAN", to: "IMPLEMENT" },
    { type: "sprint-started", sprintId: "fix-1" },
    { type: "codex-bound", sprintId: "fix-1", sessionId: "s" },
    { type: "evidence", gateId: "sprint-fix-1", sprintId: "fix-1", exitCode: 0 },
    { type: "sprint-done", sprintId: "fix-1" },
  ];
}
function goodState() {
  return { plan: { verifyCmd: "true", sprints: [{ id: "fix-1", title: "t", status: "done", provenance: "planned", codexSessions: [{ sessionId: "s", transcriptPath: "/x/r.jsonl", at: "t" }] }] } };
}
const yes = () => true;
function fails(ledger, state = goodState(), te = yes) {
  return evaluateAudit({ ledger, state, transcriptExists: te }).failures.join(" | ");
}

test("a fully honest run passes with no failures", () => {
  const r = evaluateAudit({ ledger: goodLedger(), state: goodState(), transcriptExists: yes });
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, []);
});

test("approval before its producing event fails ordering", () => {
  const l = goodLedger();
  [l[1], l[2]] = [l[2], l[1]];
  assert.match(fails(l), /ordering/);
});

test("a phase-advanced that skips a phase fails ordering", () => {
  const l = goodLedger();
  l[3] = { type: "phase-advanced", from: "DIAGNOSE", to: "PLAN" };
  assert.match(fails(l), /not a valid step|expected advance/);
});

test("an advance with no approval fails ordering", () => {
  const l = goodLedger().filter((e) => !(e.type === "approval" && e.gateId === "VERIFY"));
  assert.match(fails(l), /no preceding approval/);
});

test("VERIFY approved while blockers != 0 fails ordering", () => {
  const l = goodLedger();
  l[4] = { type: "verification", gateId: "VERIFY", blockers: 1 };
  assert.match(fails(l), /verification/);
});

test("sprint-done with no preceding codex-bound fails authorship", () => {
  const l = goodLedger().filter((e) => e.type !== "codex-bound");
  assert.match(fails(l), /authorship.*codex-bound/);
});

test("codex-bound before sprint-started fails ordering", () => {
  const l = goodLedger();
  const boundIdx = l.findIndex((e) => e.type === "codex-bound" && e.sprintId === "fix-1");
  const startIdx = l.findIndex((e) => e.type === "sprint-started" && e.sprintId === "fix-1");
  const [bound] = l.splice(boundIdx, 1);
  l.splice(startIdx, 0, bound);
  assert.match(fails(l), /was bound before it was started/);
});

test("sprint-done whose bound transcript does not exist fails authorship", () => {
  assert.match(fails(goodLedger(), goodState(), () => false), /no bound session with an existing transcript/);
});

test("sprint-done with no preceding passing evidence fails evidence", () => {
  const l = goodLedger().filter((e) => e.type !== "evidence");
  assert.match(fails(l), /evidence/);
});

test("a sprint marked done in state with no sprint-done ledger entry fails consistency", () => {
  const l = goodLedger().filter((e) => e.type !== "sprint-done"); // state still has fix-1 done; ledger no longer records it
  assert.match(fails(l), /consistency: sprint fix-1 is done in state/);
});

test("a worked/done sprint with no provenance fails the audit", () => {
  const state = { plan: { verifyCmd: "true", sprints: [{ id: "fix-1", title: "t", status: "done", codexSessions: [{ sessionId: "s", transcriptPath: "/x/r.jsonl", at: "t" }] }] } };
  assert.match(evaluateAudit({ ledger: goodLedger(), state, transcriptExists: yes }).failures.join(" | "), /provenance: sprint fix-1 is done but has no valid provenance/);
});

test("a promoted sprint with no decision / no ledger trail fails the audit", () => {
  const state = { plan: { verifyCmd: "true", sprints: [{ id: "fix-1", title: "t", status: "done", provenance: "promoted", codexSessions: [{ sessionId: "s", transcriptPath: "/x/r.jsonl", at: "t" }] }] } };
  const f = evaluateAudit({ ledger: goodLedger(), state, transcriptExists: yes }).failures.join(" | ");
  assert.match(f, /promoted sprint fix-1 has no promotion decision/);
  assert.match(f, /promoted sprint fix-1 has no sprint-promoted ledger entry/);
});

test("a promoted sprint WITH a decision + ledger trail passes provenance", () => {
  const ledger = goodLedger();
  const startIdx = ledger.findIndex((e) => e.type === "sprint-started" && e.sprintId === "fix-1");
  ledger.splice(startIdx, 0, { type: "sprint-promoted", id: "fix-1", reason: "r" });
  const state = { plan: { verifyCmd: "true", sprints: [{ id: "fix-1", title: "t", status: "done", provenance: "promoted", codexSessions: [{ sessionId: "s", transcriptPath: "/x/r.jsonl", at: "t" }] }] }, promotions: [{ id: "fix-1", discoveredBy: "orchestrator", reason: "r", decidedBy: "orchestrator", at: "t" }] };
  assert.equal(evaluateAudit({ ledger, state, transcriptExists: yes }).ok, true);
});

test("a promoted sprint started before its sprint-promoted ledger entry fails ordering", () => {
  const ledger = [...goodLedger(), { type: "sprint-promoted", id: "fix-1", reason: "r" }];
  const state = { plan: { verifyCmd: "true", sprints: [{ id: "fix-1", title: "t", status: "done", provenance: "promoted", codexSessions: [{ sessionId: "s", transcriptPath: "/x/r.jsonl", at: "t" }] }] }, promotions: [{ id: "fix-1", discoveredBy: "orchestrator", reason: "r", decidedBy: "orchestrator", at: "t" }] };
  assert.match(evaluateAudit({ ledger, state, transcriptExists: yes }).failures.join(" | "), /started before it was promoted/);
});

test("sprint evidence recorded before sprint-started fails ordering", () => {
  const ledger = goodLedger();
  const startIdx = ledger.findIndex((e) => e.type === "sprint-started" && e.sprintId === "fix-1");
  const evidenceIdx = ledger.findIndex((e) => e.type === "evidence" && e.sprintId === "fix-1");
  const [evidence] = ledger.splice(evidenceIdx, 1);
  ledger.splice(startIdx, 0, evidence);
  assert.match(fails(ledger), /evidence was recorded before it was started/);
});

test("audit fails when a sprint started before its dependency was done", () => {
  const l = [
    { type: "sprint-started", sprintId: "a" },
    { type: "sprint-started", sprintId: "b" },   // b starts before a is done
    { type: "sprint-done", sprintId: "a" },
  ];
  const state = { plan: { sprints: [
    { id: "a", title: "t", status: "done", provenance: "planned", needs: [] },
    { id: "b", title: "t", status: "in-progress", provenance: "planned", needs: ["a"] },
  ] } };
  assert.match(evaluateAudit({ ledger: l, state, transcriptExists: yes }).failures.join(" | "), /sprint b started before its dependency a was done/);
});

test("audit passes when a dependency was done before the dependent started", () => {
  const l = [
    { type: "sprint-started", sprintId: "a" },
    { type: "sprint-done", sprintId: "a" },
    { type: "sprint-started", sprintId: "b" },
  ];
  const state = { plan: { sprints: [
    { id: "a", title: "t", status: "done", provenance: "planned", needs: [] },
    { id: "b", title: "t", status: "in-progress", provenance: "planned", needs: ["a"] },
  ] } };
  assert.doesNotMatch(evaluateAudit({ ledger: l, state, transcriptExists: yes }).failures.join(" | "), /started before its dependency/);
});

test("audit fails on an undecided irreversible action", () => {
  const state = { ...goodState(), actions: [{ id: "del-1", type: "delete-path", irreversible: true, reasons: [], status: "proposed", at: "t" }] };
  assert.match(evaluateAudit({ ledger: goodLedger(), state, transcriptExists: yes }).failures.join(" | "), /irreversible action del-1 is undecided/);
});

test("audit passes once the irreversible action is ratified or denied", () => {
  const ratified = { ...goodState(), actions: [{ id: "del-1", type: "delete-path", irreversible: true, reasons: [], status: "ratified", at: "t" }] };
  assert.doesNotMatch(evaluateAudit({ ledger: goodLedger(), state: ratified, transcriptExists: yes }).failures.join(" | "), /undecided/);
  const denied = { ...goodState(), actions: [{ id: "del-1", type: "delete-path", irreversible: true, reasons: [], status: "denied", at: "t" }] };
  assert.doesNotMatch(evaluateAudit({ ledger: goodLedger(), state: denied, transcriptExists: yes }).failures.join(" | "), /undecided/);
});

test("auditRun reads a real run dir: PASS with a real transcript, FAIL without", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jam-audit-"));
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  const tp = path.join(root, "transcript.jsonl");
  fs.writeFileSync(tp, "{}\n");
  const s = readState(dir);
  s.phase = "IMPLEMENT";
  s.plan = { verifyCmd: "true", sprints: [{ id: "fix-1", title: "t", status: "done", provenance: "planned", codexSessions: [{ sessionId: "s", transcriptPath: tp, at: "t" }] }] };
  writeState(dir, s);
  for (const e of goodLedger().slice(1)) appendLedger(dir, { at: "t", ...e });
  assert.equal(auditRun({ runDir: dir }).ok, true);
  fs.rmSync(tp);
  assert.equal(auditRun({ runDir: dir }).ok, false);
});

test("an isolated sprint-done requires a preceding turn-reconciled of the same sprint", () => {
  const ledger = [
    { type: "turn-opened", sprintId: "s1", token: "s1#1", isolated: true },
    { type: "codex-bound", sprintId: "s1" },
    { type: "evidence", sprintId: "s1", gateId: "sprint-s1", exitCode: 0 },
    { type: "sprint-done", sprintId: "s1" },        // NO turn-reconciled between open and done
  ];
  const state = { mode: "repair", plan: { sprints: [{ id: "s1", status: "done", provenance: "planned", codexSessions: [{ transcriptPath: "/x" }] }] } };
  const r = evaluateAudit({ ledger, state, transcriptExists: () => true });
  assert.ok(r.failures.some((f) => /turn-reconciled|reconcile/.test(f)));
});

test("audit fails when sprint-done evidence predates the reconciled turn", () => {
  const ledger = [
    { type: "sprint-started", sprintId: "s1" },
    { type: "turn-opened", sprintId: "s1", token: "s1#1", isolated: true },
    { type: "codex-bound", sprintId: "s1" },
    { type: "evidence", sprintId: "s1", gateId: "sprint-s1", exitCode: 0 },
    { type: "turn-reconciled", sprintId: "s1", token: "s1#1" },
    { type: "sprint-done", sprintId: "s1" },
  ];
  const state = { mode: "repair", plan: { sprints: [{ id: "s1", status: "done", provenance: "planned", codexSessions: [{ transcriptPath: "/x" }] }] } };
  const r = evaluateAudit({ ledger, state, transcriptExists: () => true });
  assert.ok(r.failures.includes("evidence: sprint-done s1 evidence predates the reconciled turn — re-verify after reconcile"));
});

test("an unisolated sprint-done (turn-unisolated) is allowed (recorded, not failed)", () => {
  const ledger = [
    { type: "turn-unisolated", sprintId: "s1" },
    { type: "codex-bound", sprintId: "s1" }, { type: "sprint-started", sprintId: "s1" },
    { type: "evidence", sprintId: "s1", gateId: "sprint-s1", exitCode: 0 },
    { type: "sprint-done", sprintId: "s1" },
  ];
  const state = { mode: "repair", plan: { sprints: [{ id: "s1", status: "done", provenance: "planned", codexSessions: [{ transcriptPath: "/x" }] }] } };
  const r = evaluateAudit({ ledger, state, transcriptExists: () => true });
  assert.ok(!r.failures.some((f) => /turn-reconciled|reconcile/.test(f)));
});
