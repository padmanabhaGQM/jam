import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-clispec-")); }
function jam(cwd, args) { return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" }); }
function wj(root, name, obj) { const p = path.join(root, name); fs.writeFileSync(p, JSON.stringify(obj)); return p; }

// Drive GROUND->CONVERGE->SPECIFY via the CLI.
function toSpecify(root, dims) {
  jam(root, ["start", "build x", "--run-id", "r1", "--mode", "greenfield"]);
  jam(root, ["ground", "sharpen", "--file", wj(root, "s.json", { problem: "p", dimensions: dims })]);
  jam(root, ["approve", "GROUND-scope"]);
  jam(root, ["ground", "claim", "--file", wj(root, "c.json", { id: "c1", text: "x", kind: "framing", status: "evidenced", source: "both" })]);
  jam(root, ["ground", "converge"]);
  jam(root, ["approve", "GROUND"]);
  jam(root, ["advance"]);
  jam(root, ["converge", "shortlist", "--file", wj(root, "sl.json", { options: ["opt-A"] })]);
  jam(root, ["approve", "CONVERGE-shortlist"]);
  jam(root, ["converge", "decide", "--agent", "claude", "--file", wj(root, "dc.json", { chosen: "opt-A" })]);
  jam(root, ["converge", "decide", "--agent", "codex", "--file", wj(root, "dx.json", { chosen: "opt-A" })]);
  jam(root, ["converge", "finalize", "--file", wj(root, "fin.json", { ledger: dims.map((d) => ({ dimension: d, status: "at-risk", rationale: "x", accepted: true })), spikes: [] })]);
  jam(root, ["approve", "CONVERGE"]);
  jam(root, ["advance"]);
}

test("CLI drives SPECIFY end-to-end to the BUILD-stub boundary", () => {
  const root = tmp();
  toSpecify(root, ["WER<5%"]);
  assert.match(jam(root, ["status"]).stdout, /phase SPECIFY/);
  jam(root, ["specify", "coverage", "--file", wj(root, "cov.json", { verifyCmd: "exit 1", checks: [{ id: "c1", dimension: "WER<5%", ref: "t1" }] })]);
  assert.match(jam(root, ["status"]).stdout, /SPECIFY-coverage: human\/covered/);
  jam(root, ["approve", "SPECIFY-coverage"]);
  assert.equal(jam(root, ["specify", "redproof"]).status, 0);
  jam(root, ["specify", "gameability", "--file", wj(root, "g.json", { reviewer: "codex", author: "claude", survivingFindings: 0, findings: [] })]);
  assert.equal(jam(root, ["specify", "certify"]).status, 0);
  assert.match(jam(root, ["status"]).stdout, /SPECIFY: human\/specified|specified/);
  jam(root, ["approve", "SPECIFY"]);
  const adv = jam(root, ["advance"]);
  assert.match(adv.stderr + adv.stdout, /BUILD is not yet implemented \(ships in ganjam G4\)/);
});

test("CLI: a passing verifyCmd (exit 0) is rejected at certify (red-first)", () => {
  const root = tmp();
  toSpecify(root, ["WER<5%"]);
  jam(root, ["specify", "coverage", "--file", wj(root, "cov.json", { verifyCmd: "exit 0", checks: [{ id: "c1", dimension: "WER<5%", ref: "t1" }] })]);
  jam(root, ["approve", "SPECIFY-coverage"]);
  jam(root, ["specify", "redproof"]);
  jam(root, ["specify", "gameability", "--file", wj(root, "g.json", { reviewer: "codex", author: "claude", survivingFindings: 0 })]);
  assert.notEqual(jam(root, ["specify", "certify"]).status, 0);
});
