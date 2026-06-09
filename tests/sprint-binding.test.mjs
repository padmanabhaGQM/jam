import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";
import { readState, writeState, validateState } from "../plugins/jam/scripts/lib/state.mjs";
import { bindCodexSession } from "../plugins/jam/scripts/lib/sprint.mjs";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-bind-")); }
function runWithSprint() {
  const dir = createRun({ projectRoot: tmp(), runId: "r1", mode: "repair", now: "t" });
  const s = readState(dir);
  s.phase = "IMPLEMENT";
  s.plan = { verifyCmd: "true", sprints: [{ id: "fix-1", title: "t", acceptanceCriteria: "ac", status: "in-progress", provenance: "planned" }] };
  writeState(dir, s);
  return dir;
}

test("bindCodexSession appends a session entry to the sprint", () => {
  const dir = runWithSprint();
  bindCodexSession({ runDir: dir, sprintId: "fix-1", sessionId: "sess-1", transcriptPath: "/x/rollout-sess-1.jsonl", now: "t1" });
  const sp = readState(dir).plan.sprints[0];
  assert.equal(sp.codexSessions.length, 1);
  assert.deepEqual(sp.codexSessions[0], { sessionId: "sess-1", transcriptPath: "/x/rollout-sess-1.jsonl", at: "t1" });
});

test("bindCodexSession tolerates a null transcriptPath and appends (not replaces)", () => {
  const dir = runWithSprint();
  bindCodexSession({ runDir: dir, sprintId: "fix-1", sessionId: "a", transcriptPath: null, now: "t1" });
  bindCodexSession({ runDir: dir, sprintId: "fix-1", sessionId: "b", transcriptPath: "/x/b.jsonl", now: "t2" });
  const sp = readState(dir).plan.sprints[0];
  assert.equal(sp.codexSessions.length, 2);
  assert.equal(sp.codexSessions[0].transcriptPath, null);
});

test("bindCodexSession throws on an unknown sprint", () => {
  const dir = runWithSprint();
  assert.throws(() => bindCodexSession({ runDir: dir, sprintId: "nope", sessionId: "x" }), /unknown sprint/);
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
