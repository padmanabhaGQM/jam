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
  const ledger = [...goodLedger(), { type: "sprint-promoted", id: "fix-1", reason: "r" }];
  const state = { plan: { verifyCmd: "true", sprints: [{ id: "fix-1", title: "t", status: "done", provenance: "promoted", codexSessions: [{ sessionId: "s", transcriptPath: "/x/r.jsonl", at: "t" }] }] }, promotions: [{ id: "fix-1", discoveredBy: "orchestrator", reason: "r", decidedBy: "orchestrator", at: "t" }] };
  assert.equal(evaluateAudit({ ledger, state, transcriptExists: yes }).ok, true);
});

test("auditRun reads a real run dir: PASS with a real transcript, FAIL without", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jam-audit-"));
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  const tp = path.join(root, "transcript.jsonl");
  fs.writeFileSync(tp, "{}\n");
  const s = readState(dir);
  s.plan = { verifyCmd: "true", sprints: [{ id: "fix-1", title: "t", status: "done", provenance: "planned", codexSessions: [{ sessionId: "s", transcriptPath: tp, at: "t" }] }] };
  writeState(dir, s);
  for (const e of goodLedger().slice(1)) appendLedger(dir, { at: "t", ...e });
  assert.equal(auditRun({ runDir: dir }).ok, true);
  fs.rmSync(tp);
  assert.equal(auditRun({ runDir: dir }).ok, false);
});
