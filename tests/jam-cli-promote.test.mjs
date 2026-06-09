import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
const FAKE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-clipromote-")); }
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

test("jam promote-sprint records a promoted sprint and status shows provenance + promotion", () => {
  const root = tmp();
  toImplement(root);
  const r = jam(root, ["promote-sprint", "fix-9", "--title", "discovered", "--reason", "found during fix-1"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /promoted sprint fix-9/);
  const st = jam(root, ["status"]).stdout;
  assert.match(st, /sprint fix-1: pending \[planned\]/);
  assert.match(st, /sprint fix-9: pending \[promoted\]/);
  assert.match(st, /promotion fix-9: found during fix-1/);
});

test("jam promote-sprint requires id, title, and reason", () => {
  const root = tmp();
  toImplement(root);
  assert.notEqual(jam(root, ["promote-sprint", "fix-9", "--title", "t"]).status, 0);
});

test("a promoted sprint can be driven to done and the run reaches FINISH", () => {
  const root = tmp();
  toImplement(root);
  assert.equal(jam(root, ["promote-sprint", "fix-9", "--title", "extra", "--reason", "discovered"]).status, 0);
  const codexHome = tmp();
  const sessDir = path.join(codexHome, "sessions");
  fs.mkdirSync(sessDir, { recursive: true });
  for (const [sid, sprint] of [["sess-fix-1", "fix-1"], ["sess-fix-9", "fix-9"]]) {
    fs.writeFileSync(path.join(sessDir, `rollout-2026-06-09T00-00-00-${sid}.jsonl`), "{}\n");
    const env = { JAM_CODEX_BIN: FAKE, JAM_FAKE_SESSION_ID: sid, CODEX_HOME: codexHome };
    assert.equal(jam(root, ["sprint", sprint, "--start"]).status, 0);
    const pf = path.join(root, `${sprint}.md`); fs.writeFileSync(pf, "impl");
    jam(root, ["codex-run", "--sprint", sprint, "--prompt-file", pf, "--out-dir", path.join(root, "cx-" + sprint)], env);
    jam(root, ["sprint", sprint, "--verify"]);
    assert.equal(jam(root, ["sprint", sprint, "--done"]).status, 0, `done ${sprint} should succeed`);
  }
  assert.equal(jam(root, ["advance"]).status, 0);
  assert.match(jam(root, ["status"]).stdout, /phase FINISH/);
});
