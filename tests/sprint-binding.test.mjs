import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";
import { readState, writeState, validateState } from "../plugins/jam/scripts/lib/state.mjs";
import { bindCodexSession, finishSprint } from "../plugins/jam/scripts/lib/sprint.mjs";
import { fakeCodexHome } from "./helpers/codex.mjs";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-bind-")); }
function runWithSprint() {
  const dir = createRun({ projectRoot: tmp(), runId: "r1", mode: "repair", now: "t" });
  const s = readState(dir);
  s.phase = "IMPLEMENT";
  s.plan = { verifyCmd: "true", sprints: [{ id: "fix-1", title: "t", acceptanceCriteria: "ac", status: "in-progress", provenance: "planned" }] };
  writeState(dir, s);
  return dir;
}
function runWithPendingSprint() {
  const dir = runWithSprint();
  const s = readState(dir);
  s.plan.sprints[0].status = "pending";
  writeState(dir, s);
  return dir;
}

test("bindCodexSession appends a session entry to the sprint", () => {
  const dir = runWithSprint();
  const { codexHome, transcriptPath } = fakeCodexHome("sess-1");
  bindCodexSession({ runDir: dir, sprintId: "fix-1", sessionId: "sess-1", codexHome, now: "t1" });
  const sp = readState(dir).plan.sprints[0];
  assert.equal(sp.codexSessions.length, 1);
  assert.deepEqual(sp.codexSessions[0], { sessionId: "sess-1", transcriptPath, at: "t1" });
});

test("bindCodexSession tolerates a missing located transcript and appends (not replaces)", () => {
  const dir = runWithSprint();
  const { codexHome, transcriptPath } = fakeCodexHome("b");
  bindCodexSession({ runDir: dir, sprintId: "fix-1", sessionId: "a", codexHome, now: "t1" });
  bindCodexSession({ runDir: dir, sprintId: "fix-1", sessionId: "b", codexHome, now: "t2" });
  const sp = readState(dir).plan.sprints[0];
  assert.equal(sp.codexSessions.length, 2);
  assert.equal(sp.codexSessions[0].transcriptPath, null);
  assert.equal(sp.codexSessions[1].transcriptPath, transcriptPath);
});

test("bindCodexSession throws on an unknown sprint", () => {
  const dir = runWithSprint();
  assert.throws(() => bindCodexSession({ runDir: dir, sprintId: "nope", sessionId: "x" }), /unknown sprint/);
});

test("bindCodexSession throws unless the sprint is in-progress", () => {
  const dir = runWithPendingSprint();
  assert.throws(
    () => bindCodexSession({ runDir: dir, sprintId: "fix-1", sessionId: "x" }),
    /sprint fix-1 is not in-progress \(start it before binding a Codex session\)/
  );
});

test("validateState rejects malformed codexSessions, accepts well-formed and absent", () => {
  const dir = runWithSprint();
  const ok = readState(dir);
  assert.equal(validateState(ok).length, 0);
  ok.plan.sprints[0].codexSessions = [{ sessionId: "s", transcriptPath: null, at: "t" }];
  assert.equal(validateState(ok).length, 0);
  ok.plan.sprints[0].codexSessions = [{ transcriptPath: "/x", at: "t" }];
  assert.ok(validateState(ok).length > 0);
  ok.plan.sprints[0].codexSessions = "nope";
  assert.ok(validateState(ok).length > 0);
});

test("validateState rejects a done sprint with no bound Codex session, accepts one with a binding", () => {
  const dir = runWithSprint();
  const s = readState(dir);
  s.plan.sprints[0].status = "done";
  assert.ok(validateState(s).some((e) => /done but has no bound Codex session/.test(e)));
  s.plan.sprints[0].codexSessions = [{ sessionId: "x", transcriptPath: null, at: "t" }];
  assert.equal(validateState(s).length, 0);
});

test("bindCodexSession stores null for a made-up session and finishSprint refuses it", () => {
  const dir = runWithSprint();
  const { codexHome } = fakeCodexHome("real-session");
  bindCodexSession({ runDir: dir, sprintId: "fix-1", sessionId: "made-up", codexHome, now: "t1" });
  const state = readState(dir);
  assert.deepEqual(state.plan.sprints[0].codexSessions[0], { sessionId: "made-up", transcriptPath: null, at: "t1" });
  state.gates["sprint-fix-1"] = { mode: "auto", status: "evidence-passed", approvedBy: null, approvedAt: null, evidenceRef: null, approveFrom: "rendered" };
  writeState(dir, state);
  assert.throws(
    () => finishSprint({ runDir: dir, sprintId: "fix-1", codexHome }),
    /no Codex-authored session/
  );
});

test("bindCodexSession rejects a caller transcriptPath that differs from the located rollout", () => {
  const dir = runWithSprint();
  const { codexHome } = fakeCodexHome("sess-1");
  const mismatched = path.join(tmp(), "other-rollout-sess-1.jsonl");
  fs.writeFileSync(mismatched, "{}\n");
  assert.throws(
    () => bindCodexSession({ runDir: dir, sprintId: "fix-1", sessionId: "sess-1", transcriptPath: mismatched, codexHome }),
    /does not match the located Codex rollout/
  );
});
