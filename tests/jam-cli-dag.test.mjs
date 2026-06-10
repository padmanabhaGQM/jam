import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
const FAKE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-clidag-")); }
function jam(cwd, args, env = {}) { return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } }); }
function writeJSON(p, o) { fs.writeFileSync(p, JSON.stringify(o)); return p; }
function digestObj() {
  return { runId: "r1", phase: "DIAGNOSE", summary: "s", traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
    decisions: [], globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false }, coverage: { addressed: [], dropped: [] } };
}
function toPlanThenImplement(root, plan) {
  jam(root, ["diagnose", "fix", "--goal", writeJSON(path.join(root, "g.txt"), { x: 1 }), "--run-id", "r1"]);
  jam(root, ["render-digest", "DIAGNOSE", "--file", writeJSON(path.join(root, "d.json"), digestObj())]);
  jam(root, ["approve", "DIAGNOSE"]); jam(root, ["advance"]);
  jam(root, ["verify", "--file", writeJSON(path.join(root, "v.json"), { unresolvedBlockers: 0 })]);
  jam(root, ["approve", "VERIFY"]); jam(root, ["advance"]);
  const r = jam(root, ["plan", "--file", writeJSON(path.join(root, "plan.json"), plan)]);
  jam(root, ["approve", "PLAN"]); jam(root, ["advance"]);
  return r;
}

test("jam plan accepts needs; status shows ready/blocked; start refuses a blocked sprint", () => {
  const root = tmp();
  toPlanThenImplement(root, { verifyCmd: "true", sprints: [{ id: "a", title: "ta" }, { id: "b", title: "tb", needs: ["a"] }] });
  const st = jam(root, ["status"]).stdout;
  assert.match(st, /sprint a: pending \[planned\].*\(ready\)/);
  assert.match(st, /sprint b: pending \[planned\].*\(blocked\)/);
  const start = jam(root, ["sprint", "b", "--start"]);
  assert.notEqual(start.status, 0);
  assert.match(start.stderr, /blocked: needs a/);
});

test("jam plan rejects a cyclic sprint graph", () => {
  const root = tmp();
  jam(root, ["diagnose", "fix", "--goal", writeJSON(path.join(root, "g.txt"), { x: 1 }), "--run-id", "r1"]);
  jam(root, ["render-digest", "DIAGNOSE", "--file", writeJSON(path.join(root, "d.json"), digestObj())]);
  jam(root, ["approve", "DIAGNOSE"]); jam(root, ["advance"]);
  jam(root, ["verify", "--file", writeJSON(path.join(root, "v.json"), { unresolvedBlockers: 0 })]);
  jam(root, ["approve", "VERIFY"]); jam(root, ["advance"]);
  const r = jam(root, ["plan", "--file", writeJSON(path.join(root, "p.json"), { verifyCmd: "true", sprints: [{ id: "a", title: "t", needs: ["b"] }, { id: "b", title: "t", needs: ["a"] }] })]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /cycle/);
});

test("jam promote-sprint --needs records the dependency", () => {
  const root = tmp();
  toPlanThenImplement(root, { verifyCmd: "true", sprints: [{ id: "a", title: "ta" }] });
  assert.equal(jam(root, ["promote-sprint", "b", "--title", "tb", "--reason", "r", "--needs", "a"]).status, 0);
  assert.match(jam(root, ["status"]).stdout, /sprint b: pending \[promoted\].*needs:a/);
});

test("a two-sprint DAG (B needs A) is driven A-then-B to FINISH; B can't start before A is done", () => {
  const root = tmp();
  toPlanThenImplement(root, { verifyCmd: "true", sprints: [{ id: "a", title: "ta" }, { id: "b", title: "tb", needs: ["a"] }] });
  assert.notEqual(jam(root, ["sprint", "b", "--start"]).status, 0);
  const codexHome = tmp();
  const sessDir = path.join(codexHome, "sessions");
  fs.mkdirSync(sessDir, { recursive: true });
  for (const [sid, sprint] of [["sess-a", "a"], ["sess-b", "b"]]) {
    fs.writeFileSync(path.join(sessDir, `rollout-2026-06-09T00-00-00-${sid}.jsonl`), `{"type":"session_meta","payload":{"id":"${sid}"}}\n`);
    const env = { JAM_CODEX_BIN: FAKE, JAM_FAKE_SESSION_ID: sid, CODEX_HOME: codexHome };
    assert.equal(jam(root, ["sprint", sprint, "--start"]).status, 0, `start ${sprint}`);
    const pf = path.join(root, `${sprint}.md`); fs.writeFileSync(pf, "impl");
    jam(root, ["codex-run", "--sprint", sprint, "--prompt-file", pf, "--out-dir", path.join(root, "cx-" + sprint)], env);
    jam(root, ["sprint", sprint, "--verify"]);
    assert.equal(jam(root, ["sprint", sprint, "--done"]).status, 0, `done ${sprint}`);
  }
  assert.match(jam(root, ["audit"]).stdout, /audit: PASS/);
  assert.equal(jam(root, ["advance"]).status, 0);
  assert.match(jam(root, ["status"]).stdout, /phase FINISH/);
});
