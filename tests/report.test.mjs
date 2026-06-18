import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateReport, renderReport } from "../plugins/jam/scripts/lib/report.mjs";
import { renderStatus } from "../plugins/jam/scripts/lib/render-status.mjs";

// Synthetic FULL-FEATURE run: phases, 2 sprints (one isolated turn), VERIFY rounds reaching 0 at round 3,
// SLICE rounds reaching 0 at round 2, final-verification, audit PASS.
function fullLedger() {
  return [
    { at: "2026-06-11T10:00:00.000Z", type: "run-created", runId: "rX", topic: "demo" },
    { at: "2026-06-11T10:00:00.000Z", type: "goal-set", source: "human" },
    { at: "2026-06-11T10:00:10.000Z", type: "digest-rendered", gateId: "DIAGNOSE" },
    { at: "2026-06-11T10:00:10.000Z", type: "approval", gateId: "DIAGNOSE" },
    { at: "2026-06-11T10:01:00.000Z", type: "phase-advanced", from: "DIAGNOSE", to: "VERIFY" },
    { at: "2026-06-11T10:02:00.000Z", type: "review-round", phase: "VERIFY", round: 1, blockers: 4 },
    { at: "2026-06-11T10:03:00.000Z", type: "review-round", phase: "VERIFY", round: 2, blockers: 1, notes: "drift gate" },
    { at: "2026-06-11T10:04:00.000Z", type: "verification", gateId: "VERIFY", blockers: 0 },
    { at: "2026-06-11T10:04:00.000Z", type: "review-round", phase: "VERIFY", round: 3, blockers: 0 },
    { at: "2026-06-11T10:04:30.000Z", type: "approval", gateId: "VERIFY" },
    { at: "2026-06-11T10:05:00.000Z", type: "phase-advanced", from: "VERIFY", to: "PLAN" },
    { at: "2026-06-11T10:05:30.000Z", type: "plan-recorded" },
    { at: "2026-06-11T10:05:40.000Z", type: "approval", gateId: "PLAN" },
    { at: "2026-06-11T10:06:00.000Z", type: "phase-advanced", from: "PLAN", to: "IMPLEMENT" },
    { at: "2026-06-11T10:06:30.000Z", type: "sprint-started", sprintId: "s1" },
    { at: "2026-06-11T10:07:00.000Z", type: "turn-opened", sprintId: "s1", token: "s1#1", isolated: true },
    { at: "2026-06-11T10:16:00.000Z", type: "codex-bound", sprintId: "s1", sessionId: "sess-1" },
    { at: "2026-06-11T10:16:10.000Z", type: "turn-reconciled", sprintId: "s1", token: "s1#1" },
    { at: "2026-06-11T10:16:30.000Z", type: "evidence", sprintId: "s1", gateId: "sprint-s1", exitCode: 0 },
    { at: "2026-06-11T10:16:30.000Z", type: "sprint-done", sprintId: "s1" },
    { at: "2026-06-11T10:17:00.000Z", type: "sprint-started", sprintId: "s2" },
    { at: "2026-06-11T10:27:00.000Z", type: "codex-bound", sprintId: "s2", sessionId: "sess-2" },
    { at: "2026-06-11T10:27:30.000Z", type: "evidence", sprintId: "s2", gateId: "sprint-s2", exitCode: 0 },
    { at: "2026-06-11T10:27:30.000Z", type: "sprint-done", sprintId: "s2" },
    { at: "2026-06-11T10:28:00.000Z", type: "final-verification", command: "npm test", exitCode: 0 },
    { at: "2026-06-11T10:28:01.000Z", type: "phase-advanced", from: "IMPLEMENT", to: "FINISH" },
    { at: "2026-06-11T10:40:00.000Z", type: "review-round", phase: "SLICE", round: 1, blockers: 3 },
    { at: "2026-06-11T10:50:00.000Z", type: "review-round", phase: "SLICE", round: 2, blockers: 0 },
  ];
}
function fullState() {
  return {
    runId: "rX", mode: "repair", phase: "FINISH", topic: "demo",
    plan: { verifyCmd: "npm test", sprints: [
      { id: "s1", title: "narration", provenance: "planned", status: "done",
        codexSessions: [{ sessionId: "sess-1", transcriptPath: "/x/rollout-sess-1.jsonl" }],
        turn: { token: "s1#1", status: "reconciled", isolated: true }, turnSeq: 1 },
      { id: "s2", title: "render", provenance: "planned", status: "done",
        codexSessions: [{ sessionId: "sess-2", transcriptPath: null }] },
    ] },
  };
}

test("evaluateReport: full-feature run — phases, reviews, sprints, turns, final, audit", () => {
  const r = evaluateReport({ ledger: fullLedger(), state: fullState(), auditResult: { ok: true, failures: [] } });
  assert.equal(r.run.runId, "rX");
  assert.equal(r.run.mode, "repair");
  assert.equal(r.run.phase, "FINISH");
  assert.equal(r.run.wallMs, Date.parse("2026-06-11T10:50:00.000Z") - Date.parse("2026-06-11T10:00:00.000Z"));
  assert.equal(r.phases.length, 4);
  assert.equal(r.phases[0].to, "VERIFY");
  assert.equal(r.phases[0].dwellMs, 4 * 60_000);            // VERIFY 10:01 -> PLAN 10:05
  assert.equal(r.phases[3].dwellMs, null);                  // last advance has no dwell
  assert.deepEqual(r.reviews.roundsToZero, { VERIFY: 3, SLICE: 2 });
  assert.equal(r.reviews.verifications.length, 1);
  assert.equal(r.reviews.rounds.length, 5);
  assert.equal(r.reviews.roundDataMissing, false);
  assert.equal(r.sprints.length, 2);
  assert.equal(r.sprints[0].id, "s1");
  assert.equal(r.sprints[0].durationMs, 10 * 60_000);       // 10:06:30 -> 10:16:30
  assert.equal(r.sprints[0].bound, true);
  assert.equal(r.sprints[0].transcriptRecorded, true);
  assert.equal(r.sprints[0].evidenceExit, 0);
  assert.deepEqual(r.sprints[0].turn, { opened: 1, reconciled: 1, discarded: 0, unisolated: 0 });
  assert.equal(r.sprints[1].transcriptRecorded, false);     // null transcriptPath
  assert.equal(r.sprints[1].turn, null);                    // no turn events for s2
  assert.equal(r.totals.sprints, 2);
  assert.equal(r.totals.done, 2);
  assert.equal(r.totals.turnsReconciled, 1);
  assert.equal(r.finalVerification.present, true);
  assert.equal(r.finalVerification.exitCode, 0);
  assert.equal(r.audit.ok, true);
});

test("evaluateReport: minimal ledger (run-created only) — nulls, never throws", () => {
  const r = evaluateReport({ ledger: [{ at: "2026-06-11T10:00:00.000Z", type: "run-created", runId: "r0" }], state: { runId: "r0", mode: "repair", phase: "DIAGNOSE" }, auditResult: null });
  assert.equal(r.phases.length, 0);
  assert.equal(r.sprints.length, 0);
  assert.equal(r.reviews.rounds.length, 0);
  assert.deepEqual(r.reviews.roundsToZero, { VERIFY: null, SLICE: null });
  assert.equal(r.reviews.roundDataMissing, false);          // no verifications either — nothing missing
  assert.equal(r.finalVerification.present, false);
  assert.equal(r.audit, null);
});

// HONEST HISTORICAL ACCEPTANCE: the real foundation-hardening shape — one final verification,
// no review-round entries, 3 sprints with derivable durations.
test("evaluateReport: historical run shape — roundDataMissing true, durations derived", () => {
  const led = [
    { at: "2026-06-10T16:42:38.000Z", type: "run-created", runId: "foundation-hardening" },
    { at: "2026-06-10T17:00:29.000Z", type: "verification", gateId: "VERIFY", blockers: 0 },
    { at: "2026-06-10T17:00:46.000Z", type: "sprint-started", sprintId: "fh-1" },
    { at: "2026-06-10T17:11:57.000Z", type: "evidence", sprintId: "fh-1", gateId: "sprint-fh-1", exitCode: 0 },
    { at: "2026-06-10T17:11:57.000Z", type: "sprint-done", sprintId: "fh-1" },
    { at: "2026-06-10T17:12:34.000Z", type: "sprint-started", sprintId: "fh-2" },
    { at: "2026-06-10T17:31:43.000Z", type: "evidence", sprintId: "fh-2", gateId: "sprint-fh-2", exitCode: 0 },
    { at: "2026-06-10T17:31:43.000Z", type: "sprint-done", sprintId: "fh-2" },
    { at: "2026-06-10T17:32:06.000Z", type: "sprint-started", sprintId: "fh-3" },
    { at: "2026-06-10T17:34:30.000Z", type: "evidence", sprintId: "fh-3", gateId: "sprint-fh-3", exitCode: 0 },
    { at: "2026-06-10T17:34:30.000Z", type: "sprint-done", sprintId: "fh-3" },
    { at: "2026-06-10T17:34:47.000Z", type: "final-verification", command: "npm test", exitCode: 0 },
  ];
  const sp = (id) => ({ id, provenance: "planned", status: "done", codexSessions: [{ transcriptPath: "/x.jsonl" }] });
  const st = { runId: "foundation-hardening", mode: "repair", phase: "FINISH",
    plan: { sprints: [sp("fh-1"), sp("fh-2"), sp("fh-3")] } };
  const r = evaluateReport({ ledger: led, state: st, auditResult: { ok: true, failures: [] } });
  assert.equal(r.reviews.roundDataMissing, true);           // verification exists, no review-round entries
  assert.equal(r.sprints.length, 3);                        // the real run's 3 sprints
  assert.equal(r.sprints[0].durationMs, Date.parse(led[4].at) - Date.parse(led[2].at));   // fh-1 ≈ 11m
  assert.equal(r.sprints[1].durationMs, Date.parse(led[7].at) - Date.parse(led[5].at));   // fh-2 ≈ 19m
  assert.equal(r.sprints[2].durationMs, Date.parse(led[10].at) - Date.parse(led[8].at));  // fh-3 ≈ 2.5m
  assert.equal(r.totals.done, 3);
  assert.equal(r.finalVerification.present, true);
  assert.equal(r.audit.ok, true);
});

test("renderReport: renders the historical note + sections; plain text", () => {
  const r = evaluateReport({ ledger: fullLedger(), state: fullState(), auditResult: { ok: true, failures: [] } });
  const text = renderReport(r);
  assert.match(text, /run rX — repair — FINISH/);
  assert.match(text, /phases: DIAGNOSE → VERIFY 4m 00s → PLAN 1m 00s → IMPLEMENT 22m 01s → FINISH/);  // dwell labeled on the phase ENTERED
  assert.match(text, /sprints \(2\/2 done/);
  assert.match(text, /VERIFY 3 rounds \(rounds to zero: 3\)/);   // exact renderer format
  assert.match(text, /final-verification: ✓/);
  assert.match(text, /audit: PASS/);
  // historical note appears only when roundDataMissing
  const hist = evaluateReport({ ledger: [
    { at: "2026-06-11T10:00:00.000Z", type: "run-created", runId: "h" },
    { at: "2026-06-11T10:01:00.000Z", type: "verification", gateId: "VERIFY", blockers: 0 },
  ], state: { runId: "h", mode: "repair", phase: "VERIFY" }, auditResult: null });
  assert.match(renderReport(hist), /round-level review data not recorded/);
});

test("evaluateReport/renderReport: surfaces finishCmd and final finish verification", () => {
  const ledger = [
    { at: "2026-06-11T10:00:00.000Z", type: "run-created", runId: "r-finish", topic: "demo" },
    { at: "2026-06-11T10:05:00.000Z", type: "final-verification", command: "npm test", exitCode: 0 },
    { at: "2026-06-11T10:06:00.000Z", type: "final-finish-verification", command: "npm run render:audit", exitCode: 0 },
  ];
  const state = {
    runId: "r-finish",
    mode: "repair",
    phase: "FINISH",
    plan: { verifyCmd: "npm test", finishCmd: "npm run render:audit", sprints: [] },
  };
  const r = evaluateReport({ ledger, state, auditResult: { ok: true, failures: [] } });
  assert.deepEqual(r.plan, { verifyCmd: "npm test", finishCmd: "npm run render:audit" });
  assert.equal(r.finishVerification.present, true);
  assert.equal(r.finishVerification.command, "npm run render:audit");
  assert.equal(r.finishVerification.exitCode, 0);

  const text = renderReport(r);
  assert.match(text, /plan: verify npm test · finish npm run render:audit/);
  assert.match(text, /final-finish-verification: ✓ npm run render:audit exit 0/);
});

test("renderReport: absent final finish verification renders as dash", () => {
  const r = evaluateReport({
    ledger: [
      { at: "2026-06-11T10:00:00.000Z", type: "run-created", runId: "r-no-finish", topic: "demo" },
      { at: "2026-06-11T10:05:00.000Z", type: "final-verification", command: "npm test", exitCode: 0 },
    ],
    state: { runId: "r-no-finish", mode: "repair", phase: "FINISH", plan: { verifyCmd: "npm test", sprints: [] } },
    auditResult: null,
  });
  assert.deepEqual(r.plan, { verifyCmd: "npm test", finishCmd: null });
  assert.equal(r.finishVerification.present, false);
  assert.match(renderReport(r), /final-finish-verification: —/);
});

test("renderStatus: shows finishCmd alongside plan verifyCmd when present", () => {
  const text = renderStatus({
    phase: "IMPLEMENT",
    mode: "repair",
    gates: {},
    steeringDirectives: [],
    plan: { verifyCmd: "npm test", finishCmd: "npm run render:audit", sprints: [] },
  }, "r-status");
  assert.match(text, /verify: npm test/);
  assert.match(text, /finish: npm run render:audit/);
});

test("evaluateReport: unparseable timestamps yield null durations, no throw", () => {
  const r = evaluateReport({ ledger: [
    { type: "run-created", runId: "b" },                     // no `at` at all
    { at: "not-a-date", type: "sprint-started", sprintId: "s" },
    { at: "also-bad", type: "sprint-done", sprintId: "s" },
  ], state: { runId: "b", mode: "repair", phase: "IMPLEMENT", plan: { sprints: [{ id: "s", status: "done", provenance: "planned" }] } }, auditResult: null });
  assert.equal(r.run.wallMs, null);
  assert.equal(r.sprints[0].durationMs, null);
});
