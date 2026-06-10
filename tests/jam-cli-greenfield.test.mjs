import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-cligf-")); }
function jam(cwd, args) { return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" }); }
function writeJson(root, name, obj) { const p = path.join(root, name); fs.writeFileSync(p, JSON.stringify(obj)); return p; }

test("greenfield run drives GROUND end-to-end via the CLI to the CONVERGE-stub boundary", () => {
  const root = tmp();
  assert.equal(jam(root, ["start", "dub a show", "--run-id", "r1", "--mode", "greenfield"]).status, 0);
  assert.match(jam(root, ["status"]).stdout, /mode greenfield .* phase GROUND|phase GROUND/);

  jam(root, ["ground", "sharpen", "--file", writeJson(root, "s.json", { problem: "dub a show", dimensions: ["WER<5%"] })]);
  assert.match(jam(root, ["status"]).stdout, /GROUND-scope: human\/scoped/);
  assert.equal(jam(root, ["approve", "GROUND-scope"]).status, 0);

  jam(root, ["ground", "claim", "--file", writeJson(root, "c.json", { id: "c1", text: "whisper ok", kind: "framing", status: "evidenced", source: "both" })]);
  assert.match(jam(root, ["status"]).stdout, /claims: 1/);

  assert.equal(jam(root, ["ground", "converge"]).status, 0);
  assert.match(jam(root, ["status"]).stdout, /GROUND: human\/grounded|grounded/);
  assert.equal(jam(root, ["approve", "GROUND"]).status, 0);

  const adv = jam(root, ["advance"]);
  assert.notEqual(adv.status, 0);
  assert.match(adv.stderr + adv.stdout, /CONVERGE is not yet implemented \(ships in ganjam G2\)/);
});

test("ground refute drops a claim; converge refuses an unsupported feasibility claim", () => {
  const root = tmp();
  jam(root, ["start", "x", "--run-id", "r1", "--mode", "greenfield"]);
  jam(root, ["ground", "sharpen", "--file", writeJson(root, "s.json", { problem: "p", dimensions: ["d"] })]);
  jam(root, ["approve", "GROUND-scope"]);
  const tr = path.join(root, "probe.jsonl"); fs.writeFileSync(tr, "{}\n");
  jam(root, ["ground", "claim", "--file", writeJson(root, "f.json", { id: "f1", text: "fast", kind: "feasibility", status: "evidenced", source: "codex", evidenceRef: tr })]);
  fs.rmSync(tr);
  assert.notEqual(jam(root, ["ground", "converge"]).status, 0);
  assert.equal(jam(root, ["ground", "refute", "--id", "f1"]).status, 0);
  assert.equal(jam(root, ["ground", "converge"]).status, 0);
});
