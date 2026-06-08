import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-cplan-")); }
function jam(cwd, args) { return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" }); }
function writeJSON(p, o) { fs.writeFileSync(p, JSON.stringify(o)); return p; }
function digestObj() {
  return { runId: "r1", phase: "DIAGNOSE", summary: "s", traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
    decisions: [], globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false }, coverage: { addressed: [], dropped: [] } };
}
function planObj() { return { verifyCmd: "bash verify.sh", sprints: [{ id: "fix-1", title: "do the thing", acceptanceCriteria: "ac" }] }; }
function toPlan(root) {
  jam(root, ["diagnose", "fix", "--goal", writeJSON(path.join(root, "g.txt"), { x: 1 }), "--run-id", "r1"]);
  jam(root, ["render-digest", "DIAGNOSE", "--file", writeJSON(path.join(root, "d.json"), digestObj())]);
  jam(root, ["approve", "DIAGNOSE"]);
  jam(root, ["advance"]); // → VERIFY
  jam(root, ["verify", "--file", writeJSON(path.join(root, "v.json"), { unresolvedBlockers: 0 })]);
  jam(root, ["approve", "VERIFY"]);
  jam(root, ["advance"]); // → PLAN
}

test("jam plan records a valid plan; status shows verify + sprints", () => {
  const root = tmp();
  toPlan(root);
  assert.match(jam(root, ["status"]).stdout, /phase PLAN/);
  const r = jam(root, ["plan", "--file", writeJSON(path.join(root, "plan.json"), planObj())]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /plan recorded/);
  const st = jam(root, ["status"]).stdout;
  assert.match(st, /verify: bash verify\.sh/);
  assert.match(st, /fix-1/);
});

test("PLAN gate cannot be satisfied by a digest, a verdict, or early approval", () => {
  const root = tmp();
  toPlan(root);
  assert.notEqual(jam(root, ["render-digest", "PLAN", "--file", writeJSON(path.join(root, "d2.json"), digestObj())]).status, 0);
  assert.notEqual(jam(root, ["verify", "--file", writeJSON(path.join(root, "v2.json"), { unresolvedBlockers: 0 })]).status, 0);
  assert.notEqual(jam(root, ["approve", "PLAN"]).status, 0);
  jam(root, ["plan", "--file", writeJSON(path.join(root, "plan.json"), planObj())]);
  assert.equal(jam(root, ["approve", "PLAN"]).status, 0);
  assert.equal(jam(root, ["advance"]).status, 0);
  assert.match(jam(root, ["status"]).stdout, /phase IMPLEMENT/);
});

test("jam plan rejects an invalid plan", () => {
  const root = tmp();
  toPlan(root);
  const r = jam(root, ["plan", "--file", writeJSON(path.join(root, "bad.json"), { sprints: [] })]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /invalid plan/);
});
