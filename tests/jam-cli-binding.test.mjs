import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
const FAKE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-bindcli-")); }
function jam(cwd, args, env = {}) { return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } }); }
function writeJSON(p, o) { fs.writeFileSync(p, JSON.stringify(o)); return p; }
function digestObj() {
  return { runId: "r1", phase: "DIAGNOSE", summary: "s", traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
    decisions: [], globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false }, coverage: { addressed: [], dropped: [] } };
}
function toImplement(root) {
  jam(root, ["diagnose", "fix", "--goal", writeJSON(path.join(root, "g.txt"), { x: 1 }), "--run-id", "r1"]);
  jam(root, ["render-digest", "DIAGNOSE", "--file", writeJSON(path.join(root, "d.json"), digestObj())]);
  jam(root, ["approve", "DIAGNOSE"]); jam(root, ["advance"]);
  jam(root, ["verify", "--file", writeJSON(path.join(root, "v.json"), { unresolvedBlockers: 0 })]);
  jam(root, ["approve", "VERIFY"]); jam(root, ["advance"]);
  jam(root, ["plan", "--file", writeJSON(path.join(root, "plan.json"), { verifyCmd: "true", sprints: [{ id: "fix-1", title: "t", acceptanceCriteria: "ac" }] })]);
  jam(root, ["approve", "PLAN"]); jam(root, ["advance"]);
}

test("codex-run --sprint binds a session with a locatable transcript; --done succeeds; status shows it", () => {
  const root = tmp();
  const codexHome = tmp();
  const sid = "jam-fake-sess-1";
  const sessDir = path.join(codexHome, "sessions");
  fs.mkdirSync(sessDir, { recursive: true });
  fs.writeFileSync(path.join(sessDir, `rollout-2026-06-09T00-00-00-${sid}.jsonl`), "{}\n");
  const env = { JAM_CODEX_BIN: FAKE, JAM_FAKE_SESSION_ID: sid, CODEX_HOME: codexHome };
  toImplement(root);
  jam(root, ["sprint", "fix-1", "--start"]);
  const pf = path.join(root, "p.md");
  fs.writeFileSync(pf, "implement this sprint");
  const run = jam(root, ["codex-run", "--sprint", "fix-1", "--prompt-file", pf, "--out-dir", path.join(root, "cx")], env);
  assert.match(run.stdout, /bound session jam-fake-sess-1 to sprint fix-1/);
  assert.doesNotMatch(run.stdout, /transcript: none/);
  jam(root, ["sprint", "fix-1", "--verify"]);
  assert.equal(jam(root, ["sprint", "fix-1", "--done"]).status, 0);
  assert.match(jam(root, ["status"]).stdout, /codex: jam-fake-sess-1/);
});

test("without a --sprint binding, --done is blocked even though verifyCmd passes", () => {
  const root = tmp();
  toImplement(root);
  jam(root, ["sprint", "fix-1", "--start"]);
  jam(root, ["sprint", "fix-1", "--verify"]);
  assert.notEqual(jam(root, ["sprint", "fix-1", "--done"]).status, 0);
});

test("codex-resume --sprint binds using the positional session id even when the resume turn emits no thread.started", () => {
  const root = tmp();
  const codexHome = tmp();
  const sid = "resume-sess-1";
  const sessDir = path.join(codexHome, "sessions");
  fs.mkdirSync(sessDir, { recursive: true });
  fs.writeFileSync(path.join(sessDir, `rollout-2026-06-09T00-00-00-${sid}.jsonl`), "{}\n");
  const env = { JAM_CODEX_BIN: FAKE, CODEX_HOME: codexHome, JAM_FAKE_NO_THREAD_STARTED: "1" };
  toImplement(root);
  jam(root, ["sprint", "fix-1", "--start"]);
  const pf = path.join(root, "reply.md");
  fs.writeFileSync(pf, "continue");
  const run = jam(root, ["codex-resume", sid, "--sprint", "fix-1", "--prompt-file", pf, "--out-dir", path.join(root, "cx")], env);
  assert.match(run.stdout, new RegExp(`bound session ${sid} to sprint fix-1`));
  jam(root, ["sprint", "fix-1", "--verify"]);
  assert.equal(jam(root, ["sprint", "fix-1", "--done"]).status, 0);
});
