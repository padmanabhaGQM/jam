import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-rep-")); }
function jam(cwd, args) { return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" }); }
function writeGoal(root) { const p = path.join(root, "goal.txt"); fs.writeFileSync(p, "reviewer mean >= 4.1"); return p; }
function writeDigest(root) {
  const p = path.join(root, "diag.json");
  fs.writeFileSync(p, JSON.stringify({ runId: "r1", phase: "DIAGNOSE", summary: "s",
    traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null }, decisions: [],
    globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false },
    coverage: { addressed: [], dropped: [] } }));
  return p;
}
function writeVerdict(root, blockers) {
  const p = path.join(root, "v.json"); fs.writeFileSync(p, JSON.stringify({ unresolvedBlockers: blockers })); return p;
}

test("diagnose starts a repair run in DIAGNOSE with the goal persisted", () => {
  const root = tmp();
  const r = jam(root, ["diagnose", "fix the spine", "--goal", writeGoal(root), "--run-id", "r1"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /DIAGNOSE/);
  assert.ok(fs.existsSync(path.join(root, "docs/superpowers/loop-runs/r1/goal.md")));
  assert.match(jam(root, ["status"]).stdout, /phase DIAGNOSE/);
});

test("advance is blocked until DIAGNOSE digest rendered+approved, then moves to VERIFY", () => {
  const root = tmp();
  jam(root, ["diagnose", "x", "--goal", writeGoal(root), "--run-id", "r1"]);
  const blocked = jam(root, ["advance"]);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /cannot advance from DIAGNOSE/);
  jam(root, ["render-digest", "DIAGNOSE", "--file", writeDigest(root)]);
  jam(root, ["approve", "DIAGNOSE"]);
  const adv = jam(root, ["advance"]);
  assert.equal(adv.status, 0);
  assert.match(jam(root, ["status"]).stdout, /phase VERIFY/);
});

test("verify with surviving blockers does not advance; clean verdict + approve does", () => {
  const root = tmp();
  jam(root, ["diagnose", "x", "--goal", writeGoal(root), "--run-id", "r1"]);
  jam(root, ["render-digest", "DIAGNOSE", "--file", writeDigest(root)]);
  jam(root, ["approve", "DIAGNOSE"]);
  jam(root, ["advance"]); // → VERIFY
  jam(root, ["verify", "--file", writeVerdict(root, 2)]);
  assert.notEqual(jam(root, ["advance"]).status, 0);
  jam(root, ["verify", "--file", writeVerdict(root, 0)]);
  jam(root, ["approve", "VERIFY"]);
  assert.equal(jam(root, ["advance"]).status, 0);
  assert.match(jam(root, ["status"]).stdout, /phase PLAN/);
});
