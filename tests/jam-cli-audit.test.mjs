import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
const FAKE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-cliaudit-")); }
function jam(cwd, args, env = {}) { return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } }); }
function writeJSON(p, o) { fs.writeFileSync(p, JSON.stringify(o)); return p; }
function digestObj() {
  return { runId: "r1", phase: "DIAGNOSE", summary: "s", traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
    decisions: [], globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false }, coverage: { addressed: [], dropped: [] } };
}
function driveToDoneSprint(root) {
  const codexHome = tmp();
  const sid = "audit-sess-1";
  const sessDir = path.join(codexHome, "sessions");
  fs.mkdirSync(sessDir, { recursive: true });
  fs.writeFileSync(path.join(sessDir, `rollout-2026-06-09T00-00-00-${sid}.jsonl`), "{}\n");
  const env = { JAM_CODEX_BIN: FAKE, JAM_FAKE_SESSION_ID: sid, CODEX_HOME: codexHome };
  jam(root, ["diagnose", "fix", "--goal", writeJSON(path.join(root, "g.txt"), { x: 1 }), "--run-id", "r1"]);
  jam(root, ["render-digest", "DIAGNOSE", "--file", writeJSON(path.join(root, "d.json"), digestObj())]);
  jam(root, ["approve", "DIAGNOSE"]); jam(root, ["advance"]);
  jam(root, ["verify", "--file", writeJSON(path.join(root, "v.json"), { unresolvedBlockers: 0 })]);
  jam(root, ["approve", "VERIFY"]); jam(root, ["advance"]);
  jam(root, ["plan", "--file", writeJSON(path.join(root, "plan.json"), { verifyCmd: "true", sprints: [{ id: "fix-1", title: "t", acceptanceCriteria: "ac" }] })]);
  jam(root, ["approve", "PLAN"]); jam(root, ["advance"]);
  jam(root, ["sprint", "fix-1", "--start"]);
  const pf = path.join(root, "p.md"); fs.writeFileSync(pf, "impl");
  jam(root, ["codex-run", "--sprint", "fix-1", "--prompt-file", pf, "--out-dir", path.join(root, "cx")], env);
  jam(root, ["sprint", "fix-1", "--verify"]);
  jam(root, ["sprint", "fix-1", "--done"]);
}

test("jam audit reports PASS on an honestly-driven run", () => {
  const root = tmp();
  driveToDoneSprint(root);
  const r = jam(root, ["audit"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /audit: PASS/);
});
