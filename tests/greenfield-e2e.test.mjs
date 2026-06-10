import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
const FAKE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-gfe2e-")); }
function jam(cwd, args, env) { return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, JAM_CODEX_BIN: FAKE, ...env } }); }
function wj(root, name, obj) { const p = path.join(root, name); fs.writeFileSync(p, JSON.stringify(obj)); return p; }

test("FULL greenfield run: intent -> GROUND -> CONVERGE -> SPECIFY -> BUILD -> FINISH", () => {
  const root = tmp();
  // GROUND
  jam(root, ["start", "build a thing", "--run-id", "r1", "--mode", "greenfield"]);
  jam(root, ["ground", "sharpen", "--file", wj(root, "s.json", { problem: "build a thing", dimensions: ["works"] })]);
  jam(root, ["approve", "GROUND-scope"]);
  jam(root, ["ground", "claim", "--file", wj(root, "c.json", { id: "c1", text: "feasible", kind: "framing", status: "evidenced", source: "both" })]);
  jam(root, ["ground", "converge"]); jam(root, ["approve", "GROUND"]); jam(root, ["advance"]);
  // CONVERGE
  jam(root, ["converge", "shortlist", "--file", wj(root, "sl.json", { options: ["opt-A"] })]);
  jam(root, ["approve", "CONVERGE-shortlist"]);
  jam(root, ["converge", "decide", "--agent", "claude", "--file", wj(root, "dc.json", { chosen: "opt-A" })]);
  jam(root, ["converge", "decide", "--agent", "codex", "--file", wj(root, "dx.json", { chosen: "opt-A" })]);
  jam(root, ["converge", "finalize", "--file", wj(root, "fin.json", { ledger: [{ dimension: "works", status: "at-risk", rationale: "x", accepted: true }], spikes: [] })]);
  jam(root, ["approve", "CONVERGE"]); jam(root, ["advance"]);
  // SPECIFY (verifyCmd is red until built.flag exists)
  jam(root, ["specify", "coverage", "--file", wj(root, "cov.json", { verifyCmd: "test -f built.flag", checks: [{ id: "c1", dimension: "works", ref: "t1" }] })]);
  jam(root, ["approve", "SPECIFY-coverage"]);
  jam(root, ["specify", "redproof"]);
  jam(root, ["specify", "gameability", "--file", wj(root, "g.json", { reviewer: "codex", author: "claude", survivingFindings: 0 })]);
  assert.equal(jam(root, ["specify", "certify"]).status, 0);
  jam(root, ["approve", "SPECIFY"]); jam(root, ["advance"]);
  // BUILD
  assert.match(jam(root, ["status"]).stdout, /phase BUILD/);
  jam(root, ["build", "plan", "--file", wj(root, "bp.json", { sprints: [{ id: "b1", title: "make it pass", needs: [] }] })]);
  jam(root, ["approve", "BUILD-plan"]);
  jam(root, ["sprint", "b1", "--start"]);
  // bind a (fake) Codex session with a LOCATABLE rollout transcript (mirror tests/jam-cli-binding.test.mjs)
  const codexHome = path.join(root, "codex-home");
  const sid = "fake-build-1";
  fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(codexHome, "sessions", `rollout-2026-06-10T00-00-00-${sid}.jsonl`), `{"type":"session_meta","payload":{"id":"${sid}"}}\n`);
  const pf = path.join(root, "p.md"); fs.writeFileSync(pf, "build it");   // a real prompt file (not JSON)
  jam(root, ["codex-run", "--sprint", "b1", "--prompt-file", pf, "--out-dir", path.join(root, "out"), "--timeout", "5000"], { JAM_FAKE_SESSION_ID: sid, CODEX_HOME: codexHome });
  fs.writeFileSync(path.join(root, "built.flag"), "ok");   // the "build" makes the SSOT verifyCmd green
  jam(root, ["sprint", "b1", "--verify"]);
  assert.equal(jam(root, ["sprint", "b1", "--done"]).status, 0);
  // FINISH (mode-aware audit over the full greenfield ledger passes)
  assert.equal(jam(root, ["advance"]).status, 0);
  assert.match(jam(root, ["status"]).stdout, /phase FINISH/);
});
