import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-clibuild-")); }
function jam(cwd, args) { return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" }); }
function wj(root, name, obj) { const p = path.join(root, name); fs.writeFileSync(p, JSON.stringify(obj)); return p; }

// drive GROUND->CONVERGE->SPECIFY->BUILD via the CLI, certifying verifyCmd "test -f built.flag"
function toBuild(root) {
  jam(root, ["start", "x", "--run-id", "r1", "--mode", "greenfield"]);
  jam(root, ["ground", "sharpen", "--file", wj(root, "s.json", { problem: "p", dimensions: ["WER<5%"] })]);
  jam(root, ["approve", "GROUND-scope"]);
  jam(root, ["ground", "claim", "--file", wj(root, "c.json", { id: "c1", text: "x", kind: "framing", status: "evidenced", source: "both" })]);
  jam(root, ["ground", "converge"]); jam(root, ["approve", "GROUND"]); jam(root, ["advance"]);
  jam(root, ["converge", "shortlist", "--file", wj(root, "sl.json", { options: ["opt-A"] })]);
  jam(root, ["approve", "CONVERGE-shortlist"]);
  jam(root, ["converge", "decide", "--agent", "claude", "--file", wj(root, "dc.json", { chosen: "opt-A" })]);
  jam(root, ["converge", "decide", "--agent", "codex", "--file", wj(root, "dx.json", { chosen: "opt-A" })]);
  jam(root, ["converge", "finalize", "--file", wj(root, "fin.json", { ledger: [{ dimension: "WER<5%", status: "at-risk", rationale: "x", accepted: true }], spikes: [] })]);
  jam(root, ["approve", "CONVERGE"]); jam(root, ["advance"]);
  jam(root, ["specify", "coverage", "--file", wj(root, "cov.json", { verifyCmd: "test -f built.flag", checks: [{ id: "c1", dimension: "WER<5%", ref: "t1" }] })]);
  jam(root, ["approve", "SPECIFY-coverage"]);
  jam(root, ["specify", "redproof"]);
  jam(root, ["specify", "gameability", "--file", wj(root, "g.json", { reviewer: "codex", author: "claude", survivingFindings: 0 })]);
  jam(root, ["specify", "certify"]); jam(root, ["approve", "SPECIFY"]); jam(root, ["advance"]);
}

test("CLI: jam build plan records sprints (verifyCmd locked) and status shows BUILD", () => {
  const root = tmp();
  toBuild(root);
  assert.match(jam(root, ["status"]).stdout, /phase BUILD/);
  assert.equal(jam(root, ["build", "plan", "--file", wj(root, "bp.json", { sprints: [{ id: "b1", title: "impl", needs: [] }] })]).status, 0);
  assert.match(jam(root, ["status"]).stdout, /BUILD-plan: human\/planned|sprint b1/);
  assert.equal(jam(root, ["approve", "BUILD-plan"]).status, 0);
});

test("CLI: jam build plan rejects a verifyCmd != the SSOT", () => {
  const root = tmp();
  toBuild(root);
  const r = jam(root, ["build", "plan", "--file", wj(root, "bp.json", { verifyCmd: "exit 0", sprints: [{ id: "b1", title: "x" }] })]);
  assert.notEqual(r.status, 0);
});
