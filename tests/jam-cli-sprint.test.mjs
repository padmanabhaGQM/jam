import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readActiveRunId, runDir } from "../plugins/jam/scripts/lib/paths.mjs";
import { bindCodexSession } from "../plugins/jam/scripts/lib/sprint.mjs";
import { fakeCodexHome } from "./helpers/codex.mjs";
import { runJam as jam } from "./helpers/jam-main.mjs";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-csprint-")); }
function writeJSON(p, o) { fs.writeFileSync(p, JSON.stringify(o)); return p; }
function digestObj() {
  return { runId: "r1", phase: "DIAGNOSE", summary: "s", traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
    decisions: [], globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false }, coverage: { addressed: [], dropped: [] } };
}
async function toImplement(root, verifyCmd) {
  await jam(root, ["diagnose", "fix", "--goal", writeJSON(path.join(root, "g.txt"), { x: 1 }), "--run-id", "r1"]);
  await jam(root, ["render-digest", "DIAGNOSE", "--file", writeJSON(path.join(root, "d.json"), digestObj())]);
  await jam(root, ["approve", "DIAGNOSE"]); await jam(root, ["advance"]);
  await jam(root, ["verify", "--file", writeJSON(path.join(root, "v.json"), { unresolvedBlockers: 0 })]);
  await jam(root, ["approve", "VERIFY"]); await jam(root, ["advance"]);
  await jam(root, ["plan", "--file", writeJSON(path.join(root, "plan.json"), { verifyCmd, sprints: [{ id: "fix-1", title: "t", acceptanceCriteria: "ac" }] })]);
  await jam(root, ["approve", "PLAN"]); await jam(root, ["advance"]); // → IMPLEMENT
}

test("a sprint can be driven start→verify→done and the run advances to FINISH (passing verifyCmd)", async () => {
  const root = tmp();
  await toImplement(root, "true");
  assert.match((await jam(root, ["status"])).stdout, /phase IMPLEMENT/);
  assert.equal((await jam(root, ["sprint", "fix-1", "--start"])).status, 0);
  const v = await jam(root, ["sprint", "fix-1", "--verify"]);
  assert.equal(v.status, 0);
  assert.match(v.stdout, /exit 0/);
  const _rid = readActiveRunId(root);
  const { codexHome } = fakeCodexHome("s");
  const oldCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  try {
    bindCodexSession({ runDir: runDir(root, _rid), sprintId: "fix-1", sessionId: "s" });
    assert.equal((await jam(root, ["sprint", "fix-1", "--done"])).status, 0);
  } finally {
    if (oldCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = oldCodexHome;
  }
  assert.equal((await jam(root, ["advance"])).status, 0);
  assert.match((await jam(root, ["status"])).stdout, /phase FINISH/);
});

test("a failing verifyCmd blocks done and advance", async () => {
  const root = tmp();
  await toImplement(root, "false");
  await jam(root, ["sprint", "fix-1", "--start"]);
  const v = await jam(root, ["sprint", "fix-1", "--verify"]);
  assert.equal(v.status, 0);
  assert.match(v.stdout, /exit 1/);
  assert.notEqual((await jam(root, ["sprint", "fix-1", "--done"])).status, 0);   // not verified
  assert.notEqual((await jam(root, ["advance"])).status, 0);                      // not all sprints done
  assert.match((await jam(root, ["status"])).stdout, /phase IMPLEMENT/);
});

test("jam sprint with no action flag fails with usage", async () => {
  const root = tmp();
  await toImplement(root, "true");
  const r = await jam(root, ["sprint", "fix-1"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /usage: jam sprint/);
});

test("jam evidence cannot bypass a plan sprint's global verifyCmd gate", async () => {
  const root = tmp();
  await toImplement(root, "false");                 // global verifyCmd fails
  await jam(root, ["sprint", "fix-1", "--start"]);
  // try to pass the sprint gate with an arbitrary always-true command
  const ev = await jam(root, ["evidence", "sprint-fix-1", "--sprint", "fix-1", "--cmd", "true"]);
  assert.notEqual(ev.status, 0);                                        // refused
  assert.match(ev.stderr, /plan sprint/);
  assert.notEqual((await jam(root, ["sprint", "fix-1", "--done"])).status, 0);  // still cannot finish
  assert.match((await jam(root, ["status"])).stdout, /phase IMPLEMENT/);
});
