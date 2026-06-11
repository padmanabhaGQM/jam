import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";
import { readState, writeState, validateState } from "../plugins/jam/scripts/lib/state.mjs";
import { bindCodexSession, openTurn, startSprint, verifySprint, finishSprint } from "../plugins/jam/scripts/lib/sprint.mjs";
import { fakeCodexHome } from "./helpers/codex.mjs";

function atImplement() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jam-turn-"));
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  const s = readState(dir);
  s.phase = "IMPLEMENT";
  s.plan = { verifyCmd: "true", sprints: [{ id: "s1", title: "t", acceptanceCriteria: "ac", status: "pending", provenance: "planned" }] };
  writeState(dir, s);
  return { root, dir };
}

test("openTurn bumps turnSeq and records an open turn; a second openTurn supersedes the first", () => {
  const { dir } = atImplement();
  startSprint({ runDir: dir, sprintId: "s1", now: "t1" });
  const t1 = openTurn({ runDir: dir, sprintId: "s1", worktreePath: "/w/1", baselineRef: "aaa", now: "t2" });
  assert.equal(t1.token, "s1#1");
  const t2 = openTurn({ runDir: dir, sprintId: "s1", worktreePath: "/w/2", baselineRef: "bbb", now: "t3" });
  assert.equal(t2.token, "s1#2");
  const sp = readState(dir).plan.sprints[0];
  assert.equal(sp.turnSeq, 2);
  assert.equal(sp.turn.token, "s1#2");
  assert.equal(sp.turn.status, "open");
  const { codexHome } = fakeCodexHome("verified-session");
  bindCodexSession({ runDir: dir, sprintId: "s1", sessionId: "missing-session", codexHome, now: "t4" });
  assert.equal(readState(dir).plan.sprints[0].turn.sessionId, null);
  bindCodexSession({ runDir: dir, sprintId: "s1", sessionId: "verified-session", codexHome, now: "t5" });
  assert.equal(readState(dir).plan.sprints[0].turn.sessionId, "verified-session");
});

test("verifySprint and finishSprint refuse while an open turn exists", () => {
  const { root, dir } = atImplement();
  startSprint({ runDir: dir, sprintId: "s1", now: "t1" });
  openTurn({ runDir: dir, sprintId: "s1", worktreePath: "/w/1", baselineRef: "aaa", now: "t2" });
  assert.throws(() => verifySprint({ runDir: dir, sprintId: "s1", cwd: root }), /un-reconciled|open turn/);
  assert.throws(() => finishSprint({ runDir: dir, sprintId: "s1" }), /un-reconciled|open turn/);

  const fallback = atImplement();
  startSprint({ runDir: fallback.dir, sprintId: "s1", now: "t1" });
  openTurn({ runDir: fallback.dir, sprintId: "s1", isolated: false, now: "t2" });
  verifySprint({ runDir: fallback.dir, sprintId: "s1", cwd: fallback.root });
  assert.throws(() => finishSprint({ runDir: fallback.dir, sprintId: "s1" }), /no Codex-authored session/);
});

test("validateState rejects a malformed sprint.turn", () => {
  const s = readState(atImplement().dir);
  s.plan.sprints[0].turn = { token: 123, status: "bogus" };
  assert.ok(validateState(s).some((e) => /turn/.test(e)));
});
