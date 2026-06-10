import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { advanceRun } from "../plugins/jam/scripts/lib/phases.mjs";
import { startSprint, verifySprint, finishSprint, bindCodexSession } from "../plugins/jam/scripts/lib/sprint.mjs";
import { recordBuildPlan } from "../plugins/jam/scripts/lib/build.mjs";
import { atBuild } from "./helpers/converge.mjs";
import { fakeCodexHome } from "./helpers/codex.mjs";

// verifyCmd checks a flag file relative to cwd; RED until the file exists.
test("BUILD -> FINISH: not-all-sprints-done is refused; a green SSOT + done sprint + audit reaches FINISH", () => {
  const dir = atBuild(["WER<5%"], "test -f built.flag");
  const projectRoot = path.resolve(dir, "..", "..", "..", "..");
  recordBuildPlan({ runDir: dir, sprints: [{ id: "b1", title: "make it pass", needs: [] }], now: "t21" });
  recordApproval({ runDir: dir, gateId: "BUILD-plan", who: "u", now: "t22" });

  // not all sprints done yet → advance refused
  assert.throws(() => advanceRun({ runDir: dir, now: "t23" }), /not all sprints done/);

  // run the sprint: start, bind a (fake) codex session + transcript, make verifyCmd green, verify, done
  startSprint({ runDir: dir, sprintId: "b1" });
  const { codexHome } = fakeCodexHome("sess-b1");
  bindCodexSession({ runDir: dir, sprintId: "b1", sessionId: "sess-b1", codexHome, now: "t24" });
  fs.writeFileSync(path.join(projectRoot, "built.flag"), "ok");  // the "build" makes verifyCmd green
  const { result } = verifySprint({ runDir: dir, sprintId: "b1", cwd: projectRoot });
  assert.equal(result.exitCode, 0);
  finishSprint({ runDir: dir, sprintId: "b1", codexHome });

  advanceRun({ runDir: dir, now: "t25" });                        // BUILD -> FINISH (audit passes)
  assert.equal(readState(dir).phase, "FINISH");
});

test("a BUILD sprint cannot START until BUILD-plan is approved (the gate gates the loop)", () => {
  const dir = atBuild(["WER<5%"], "test -f built.flag");
  recordBuildPlan({ runDir: dir, sprints: [{ id: "b1", title: "x", needs: [] }], now: "t21" });
  // BUILD-plan is 'planned', NOT approved → startSprint must refuse
  assert.throws(() => startSprint({ runDir: dir, sprintId: "b1" }), /BUILD-plan|approved first/);
});
