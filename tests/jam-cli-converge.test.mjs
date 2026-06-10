import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-clicvg-")); }
function jam(cwd, args) { return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" }); }
function wj(root, name, obj) { const p = path.join(root, name); fs.writeFileSync(p, JSON.stringify(obj)); return p; }

function toConverge(root, dims) {
  jam(root, ["start", "build x", "--run-id", "r1", "--mode", "greenfield"]);
  jam(root, ["ground", "sharpen", "--file", wj(root, "s.json", { problem: "p", dimensions: dims })]);
  jam(root, ["approve", "GROUND-scope"]);
  jam(root, ["ground", "claim", "--file", wj(root, "c.json", { id: "c1", text: "x", kind: "framing", status: "evidenced", source: "both" })]);
  jam(root, ["ground", "converge"]);
  jam(root, ["approve", "GROUND"]);
  jam(root, ["advance"]);
}

test("CLI drives CONVERGE agree-path end-to-end to the SPECIFY-stub boundary", () => {
  const root = tmp();
  toConverge(root, ["WER<5%"]);
  assert.match(jam(root, ["status"]).stdout, /phase CONVERGE/);
  jam(root, ["converge", "shortlist", "--file", wj(root, "sl.json", { options: ["opt-A", "opt-B"] })]);
  assert.match(jam(root, ["status"]).stdout, /CONVERGE-shortlist: human\/shortlisted/);
  jam(root, ["approve", "CONVERGE-shortlist"]);
  jam(root, ["converge", "decide", "--agent", "claude", "--file", wj(root, "dc.json", { chosen: "opt-A", rationale: "x" })]);
  jam(root, ["converge", "decide", "--agent", "codex", "--file", wj(root, "dx.json", { chosen: "opt-A", rationale: "y" })]);
  assert.match(jam(root, ["status"]).stdout, /convergence: .*agree/);
  const tr = path.join(root, "s1.jsonl"); fs.writeFileSync(tr, "{}\n");
  assert.equal(jam(root, ["converge", "finalize", "--file", wj(root, "fin.json", { ledger: [{ dimension: "WER<5%", status: "satisfied", evidenceRef: tr }], spikes: [{ id: "s1", evidenceRef: tr }] })]).status, 0);
  assert.match(jam(root, ["status"]).stdout, /CONVERGE: human\/decided|decided/);
  jam(root, ["approve", "CONVERGE"]);
  const adv = jam(root, ["advance"]);
  assert.match(adv.stderr + adv.stdout, /SPECIFY is not yet implemented \(ships in ganjam G3\)/);
});

test("CLI disagree-path requires a tiebreak before finalize", () => {
  const root = tmp();
  toConverge(root, ["WER<5%"]);
  jam(root, ["converge", "shortlist", "--file", wj(root, "sl.json", { options: ["opt-A", "opt-B"] })]);
  jam(root, ["approve", "CONVERGE-shortlist"]);
  jam(root, ["converge", "decide", "--agent", "claude", "--file", wj(root, "dc.json", { chosen: "opt-A" })]);
  jam(root, ["converge", "decide", "--agent", "codex", "--file", wj(root, "dx.json", { chosen: "opt-B" })]);
  const tr = path.join(root, "s1.jsonl"); fs.writeFileSync(tr, "{}\n");
  const fin = wj(root, "fin.json", { ledger: [{ dimension: "WER<5%", status: "satisfied", evidenceRef: tr }], spikes: [{ id: "s1", evidenceRef: tr }] });
  assert.notEqual(jam(root, ["converge", "finalize", "--file", fin]).status, 0);
  assert.equal(jam(root, ["converge", "tiebreak", "--choose", "opt-A"]).status, 0);
  assert.equal(jam(root, ["converge", "finalize", "--file", fin]).status, 0);
});
