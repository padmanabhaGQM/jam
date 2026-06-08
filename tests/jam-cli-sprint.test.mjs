import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-csprint-")); }
function jam(cwd, args) { return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" }); }
function writeJSON(p, o) { fs.writeFileSync(p, JSON.stringify(o)); return p; }
function digestObj() {
  return { runId: "r1", phase: "DIAGNOSE", summary: "s", traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
    decisions: [], globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false }, coverage: { addressed: [], dropped: [] } };
}
function toImplement(root, verifyCmd) {
  jam(root, ["diagnose", "fix", "--goal", writeJSON(path.join(root, "g.txt"), { x: 1 }), "--run-id", "r1"]);
  jam(root, ["render-digest", "DIAGNOSE", "--file", writeJSON(path.join(root, "d.json"), digestObj())]);
  jam(root, ["approve", "DIAGNOSE"]); jam(root, ["advance"]);
  jam(root, ["verify", "--file", writeJSON(path.join(root, "v.json"), { unresolvedBlockers: 0 })]);
  jam(root, ["approve", "VERIFY"]); jam(root, ["advance"]);
  jam(root, ["plan", "--file", writeJSON(path.join(root, "plan.json"), { verifyCmd, sprints: [{ id: "fix-1", title: "t", acceptanceCriteria: "ac" }] })]);
  jam(root, ["approve", "PLAN"]); jam(root, ["advance"]); // → IMPLEMENT
}

test("a sprint can be driven start→verify→done and the run advances to FINISH (passing verifyCmd)", () => {
  const root = tmp();
  toImplement(root, "true");
  assert.match(jam(root, ["status"]).stdout, /phase IMPLEMENT/);
  assert.equal(jam(root, ["sprint", "fix-1", "--start"]).status, 0);
  const v = jam(root, ["sprint", "fix-1", "--verify"]);
  assert.equal(v.status, 0);
  assert.match(v.stdout, /exit 0/);
  assert.equal(jam(root, ["sprint", "fix-1", "--done"]).status, 0);
  assert.equal(jam(root, ["advance"]).status, 0);
  assert.match(jam(root, ["status"]).stdout, /phase FINISH/);
});

test("a failing verifyCmd blocks done and advance", () => {
  const root = tmp();
  toImplement(root, "false");
  jam(root, ["sprint", "fix-1", "--start"]);
  const v = jam(root, ["sprint", "fix-1", "--verify"]);
  assert.match(v.stdout, /exit 1/);
  assert.notEqual(jam(root, ["sprint", "fix-1", "--done"]).status, 0);   // not verified
  assert.notEqual(jam(root, ["advance"]).status, 0);                      // not all sprints done
  assert.match(jam(root, ["status"]).stdout, /phase IMPLEMENT/);
});

test("jam sprint with no action flag fails with usage", () => {
  const root = tmp();
  toImplement(root, "true");
  const r = jam(root, ["sprint", "fix-1"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /usage: jam sprint/);
});
