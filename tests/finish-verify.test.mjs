import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
const FAKE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-finishv-")); }
function jam(cwd, args, env = {}) { return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } }); }
function writeJSON(p, o) { fs.writeFileSync(p, JSON.stringify(o)); return p; }
function ledgerEntries(root) {
  const ledger = fs.readFileSync(path.join(root, "docs", "superpowers", "loop-runs", "r1", "ledger.jsonl"), "utf8");
  return ledger.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
function digestObj() {
  return { runId: "r1", phase: "DIAGNOSE", summary: "s", traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
    decisions: [], globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false }, coverage: { addressed: [], dropped: [] } };
}
// Drive r1 to a single DONE sprint "fix-1" with verifyCmd `test -f built.flag`; built.flag present so the sprint verifies.
function runToAllSprintsDone(root, { finishCmd } = {}) {
  const sid = "jam-fake-sess-finishv";
  const codexHome = tmp();
  fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(codexHome, "sessions", `rollout-2026-06-10T00-00-00-${sid}.jsonl`), `{"type":"session_meta","payload":{"id":"${sid}"}}\n`);
  const env = { JAM_CODEX_BIN: FAKE, JAM_FAKE_SESSION_ID: sid, CODEX_HOME: codexHome };
  fs.writeFileSync(path.join(root, "built.flag"), "x");
  jam(root, ["diagnose", "fix", "--goal", writeJSON(path.join(root, "g.txt"), { x: 1 }), "--run-id", "r1"]);
  jam(root, ["render-digest", "DIAGNOSE", "--file", writeJSON(path.join(root, "d.json"), digestObj())]);
  jam(root, ["approve", "DIAGNOSE"]); jam(root, ["advance"]);
  jam(root, ["verify", "--file", writeJSON(path.join(root, "v.json"), { unresolvedBlockers: 0 })]);
  jam(root, ["approve", "VERIFY"]); jam(root, ["advance"]);
  const plan = { verifyCmd: "test -f built.flag", sprints: [{ id: "fix-1", title: "t", acceptanceCriteria: "ac" }] };
  if (finishCmd) plan.finishCmd = finishCmd;
  jam(root, ["plan", "--file", writeJSON(path.join(root, "plan.json"), plan)]);
  jam(root, ["approve", "PLAN"]); jam(root, ["advance"]);
  jam(root, ["sprint", "fix-1", "--start"]);
  const pf = path.join(root, "p.md"); fs.writeFileSync(pf, "do it");
  jam(root, ["codex-run", "--sprint", "fix-1", "--prompt-file", pf, "--out-dir", path.join(root, "cx")], env);
  jam(root, ["sprint", "fix-1", "--verify"]);
  jam(root, ["sprint", "fix-1", "--done"]);
  return { root };
}

test("advance IMPLEMENT->FINISH is REFUSED when the locked verifyCmd is now red", () => {
  const root = tmp();
  runToAllSprintsDone(root);
  fs.rmSync(path.join(root, "built.flag"));                 // break the tree AFTER the sprint passed
  const r = jam(root, ["advance"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /currently red/);
});

test("advance IMPLEMENT->FINISH SUCCEEDS + records final-verification when verifyCmd is green now", () => {
  const root = tmp();
  runToAllSprintsDone(root);                                // built.flag still present
  const r = jam(root, ["advance"]);
  assert.equal(r.status, 0);
  assert.match(jam(root, ["status"]).stdout, /phase FINISH/);
  const ledger = ledgerEntries(root);
  assert.ok(ledger.some((entry) => entry.type === "final-verification" && entry.exitCode === 0));
  assert.equal(ledger.some((entry) => entry.type === "final-finish-verification"), false);
});

test("advance IMPLEMENT->FINISH with green finishCmd succeeds + records final-finish-verification", () => {
  const root = tmp();
  runToAllSprintsDone(root, { finishCmd: "test -f built.flag" });
  const r = jam(root, ["advance"]);
  assert.equal(r.status, 0);
  assert.match(jam(root, ["status"]).stdout, /phase FINISH/);
  const ledger = ledgerEntries(root);
  assert.ok(ledger.some((entry) => entry.type === "final-verification" && entry.exitCode === 0));
  assert.ok(ledger.some((entry) => entry.type === "final-finish-verification" && entry.command === "test -f built.flag" && entry.exitCode === 0));
});

test("advance IMPLEMENT->FINISH with red finishCmd is blocked after verifyCmd passes", () => {
  const root = tmp();
  runToAllSprintsDone(root, { finishCmd: "test -f missing.flag" });
  const r = jam(root, ["advance"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /finishCmd is currently red/);
  assert.match(jam(root, ["status"]).stdout, /phase IMPLEMENT/);
  const ledger = ledgerEntries(root);
  assert.ok(ledger.some((entry) => entry.type === "final-verification" && entry.exitCode === 0));
  assert.equal(ledger.some((entry) => entry.type === "final-finish-verification" && entry.exitCode === 0), false);
});

// Greenfield BUILD->FINISH shares the same advanceRun branch; prove the live-red refusal there too (lib-level).
test("greenfield BUILD->FINISH is REFUSED when the locked verifyCmd is now red", async () => {
  const { atBuild } = await import("./helpers/converge.mjs");
  const { fakeCodexHome } = await import("./helpers/codex.mjs");
  const { recordBuildPlan } = await import("../plugins/jam/scripts/lib/build.mjs");
  const { recordApproval } = await import("../plugins/jam/scripts/lib/actions.mjs");
  const { startSprint, verifySprint, bindCodexSession, finishSprint } = await import("../plugins/jam/scripts/lib/sprint.mjs");
  const { advanceRun } = await import("../plugins/jam/scripts/lib/phases.mjs");

  const dir = atBuild(["WER<5%"], "test -f built.flag");          // BUILD, verifyCmd locked to the file check
  const projectRoot = path.resolve(dir, "..", "..", "..", "..");
  recordBuildPlan({ runDir: dir, sprints: [{ id: "b1", title: "t" }], now: "tb" });
  recordApproval({ runDir: dir, gateId: "BUILD-plan", who: "u", now: "tb2" });
  fs.writeFileSync(path.join(projectRoot, "built.flag"), "x");    // green so the sprint verifies
  startSprint({ runDir: dir, sprintId: "b1", now: "tb3" });
  const { codexHome } = fakeCodexHome("sess-b1");
  bindCodexSession({ runDir: dir, sprintId: "b1", sessionId: "sess-b1", codexHome, now: "tb4" });
  verifySprint({ runDir: dir, sprintId: "b1", cwd: projectRoot, now: "tb5" });
  finishSprint({ runDir: dir, sprintId: "b1", now: "tb6" });
  fs.rmSync(path.join(projectRoot, "built.flag"));               // break the tree after the sprint passed
  assert.throws(() => advanceRun({ runDir: dir, now: "tb7" }), /currently red/);
});

// advancePhase is the in-memory transition core; it must REFUSE the FINISH transition unless advanceRun
// (which performs the live re-verify) authorizes it — closing the exported-advancePhase bypass.
test("advancePhase refuses the FINISH transition without the verified flag", async () => {
  const { createInitialState } = await import("../plugins/jam/scripts/lib/state.mjs");
  const { advancePhase } = await import("../plugins/jam/scripts/lib/phases.mjs");
  const s = createInitialState({ runId: "r1", now: "t", mode: "repair" });
  s.phase = "IMPLEMENT";
  s.plan = { verifyCmd: "true", sprints: [{ id: "s1", title: "t", status: "done", provenance: "planned" }] };
  assert.throws(() => advancePhase(s), /requires live verifyCmd re-verification/);
  assert.doesNotThrow(() => advancePhase(s, { verified: true }));   // advanceRun's authorized path
  assert.equal(s.phase, "FINISH");
});
