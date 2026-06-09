import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";
import { readState, writeState } from "../plugins/jam/scripts/lib/state.mjs";
import { startSprint, verifySprint, finishSprint, allSprintsDone, bindCodexSession } from "../plugins/jam/scripts/lib/sprint.mjs";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-sprint-")); }
function runAtImplement(verifyCmd) {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  const s = readState(dir);
  s.phase = "IMPLEMENT";
  s.plan = { verifyCmd, sprints: [{ id: "fix-1", title: "t", acceptanceCriteria: "ac", status: "pending" }] };
  writeState(dir, s);
  return { root, dir };
}

test("startSprint marks in-progress and seeds an auto gate", () => {
  const { dir } = runAtImplement("true");
  startSprint({ runDir: dir, sprintId: "fix-1", now: "t1" });
  const s = readState(dir);
  assert.equal(s.plan.sprints[0].status, "in-progress");
  assert.equal(s.gates["sprint-fix-1"].mode, "auto");
});

test("startSprint refuses off-IMPLEMENT, unknown, or non-pending sprints", () => {
  const { dir } = runAtImplement("true");
  assert.throws(() => startSprint({ runDir: dir, sprintId: "nope" }), /unknown sprint/);
  const s = readState(dir); s.phase = "PLAN"; writeState(dir, s);
  assert.throws(() => startSprint({ runDir: dir, sprintId: "fix-1" }), /not IMPLEMENT/);
});

test("verifySprint passes the gate on exit 0, leaves it pending on non-zero", () => {
  const ok = runAtImplement("true");
  startSprint({ runDir: ok.dir, sprintId: "fix-1" });
  verifySprint({ runDir: ok.dir, sprintId: "fix-1", cwd: ok.root });
  assert.equal(readState(ok.dir).gates["sprint-fix-1"].status, "evidence-passed");

  const bad = runAtImplement("false");
  startSprint({ runDir: bad.dir, sprintId: "fix-1" });
  verifySprint({ runDir: bad.dir, sprintId: "fix-1", cwd: bad.root });
  assert.equal(readState(bad.dir).gates["sprint-fix-1"].status, "pending");
});

test("finishSprint refuses unless verified; marks done when verified", () => {
  const { root, dir } = runAtImplement("true");
  startSprint({ runDir: dir, sprintId: "fix-1" });
  assert.throws(() => finishSprint({ runDir: dir, sprintId: "fix-1" }), /not verified/);
  verifySprint({ runDir: dir, sprintId: "fix-1", cwd: root });
  const tp = path.join(root, "r.jsonl");
  fs.writeFileSync(tp, "{}\n");
  bindCodexSession({ runDir: dir, sprintId: "fix-1", sessionId: "s", transcriptPath: tp });
  finishSprint({ runDir: dir, sprintId: "fix-1" });
  assert.equal(readState(dir).plan.sprints[0].status, "done");
  assert.equal(allSprintsDone(readState(dir)), true);
});

test("finishSprint refuses a verified sprint that has NO Codex session", () => {
  const { root, dir } = runAtImplement("true");
  startSprint({ runDir: dir, sprintId: "fix-1" });
  verifySprint({ runDir: dir, sprintId: "fix-1", cwd: root });
  assert.throws(() => finishSprint({ runDir: dir, sprintId: "fix-1" }), /no Codex-authored session/);
});

test("finishSprint marks done when verified AND a bound session has an existing transcript on disk", () => {
  const { root, dir } = runAtImplement("true");
  startSprint({ runDir: dir, sprintId: "fix-1" });
  verifySprint({ runDir: dir, sprintId: "fix-1", cwd: root });
  const tp = path.join(root, "real-transcript.jsonl");
  fs.writeFileSync(tp, "{}\n");
  bindCodexSession({ runDir: dir, sprintId: "fix-1", sessionId: "s", transcriptPath: tp });
  finishSprint({ runDir: dir, sprintId: "fix-1" });
  assert.equal(readState(dir).plan.sprints[0].status, "done");
});

test("finishSprint refuses when the bound session's transcript does NOT exist on disk", () => {
  const { root, dir } = runAtImplement("true");
  startSprint({ runDir: dir, sprintId: "fix-1" });
  verifySprint({ runDir: dir, sprintId: "fix-1", cwd: root });
  bindCodexSession({ runDir: dir, sprintId: "fix-1", sessionId: "s", transcriptPath: path.join(root, "missing.jsonl") });
  assert.throws(() => finishSprint({ runDir: dir, sprintId: "fix-1" }), /no Codex-authored session/);
});

test("allSprintsDone is false with no plan or any non-done sprint", () => {
  const { dir } = runAtImplement("true");
  assert.equal(allSprintsDone(readState(dir)), false);
});

test("allSprintsDone is false when only some sprints are done, and when there is no plan", () => {
  const { dir } = runAtImplement("true");
  const s = readState(dir);
  s.plan.sprints = [
    { id: "a", title: "t", status: "done" },
    { id: "b", title: "t", status: "pending" }
  ];
  writeState(dir, s);
  assert.equal(allSprintsDone(readState(dir)), false);
  assert.equal(allSprintsDone({}), false);
});

test("startSprint refuses a sprint that is already in-progress", () => {
  const { dir } = runAtImplement("true");
  startSprint({ runDir: dir, sprintId: "fix-1" });
  assert.throws(() => startSprint({ runDir: dir, sprintId: "fix-1" }), /not pending/);
});
