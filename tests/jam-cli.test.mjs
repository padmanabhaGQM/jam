import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { readActiveRunId } from "../plugins/jam/scripts/lib/paths.mjs";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jam-cli-"));
}
function jam(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

test("start creates a run, sets ACTIVE pointer, prints the run id", () => {
  const root = tmpProject();
  const r = jam(root, ["start", "build a thing", "--run-id", "r1"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /r1/);
  assert.equal(readActiveRunId(root), "r1");
});

test("status reports phase and the ALIGN gate", () => {
  const root = tmpProject();
  jam(root, ["start", "x", "--run-id", "r1"]);
  const r = jam(root, ["status"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ALIGN/);
  assert.match(r.stdout, /pending/);
});

test("status with no active run exits non-zero with a clear message", () => {
  const root = tmpProject();
  const r = jam(root, ["status"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /no active jam run/i);
});

test("unknown subcommand exits non-zero", () => {
  const root = tmpProject();
  const r = jam(root, ["frobnicate"]);
  assert.notEqual(r.status, 0);
});

test("a value-flag with no value does not swallow the next flag", () => {
  const root = tmpProject();
  jam(root, ["start", "x", "--run-id", "r1"]);
  // --file has no value (followed by another flag); render-digest must reject, not crash
  const r = jam(root, ["render-digest", "ALIGN", "--file", "--mode", "auto"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /usage|file/i);
});

function writeDigest(dir) {
  const p = path.join(dir, "digest.json");
  fs.writeFileSync(p, JSON.stringify({
    runId: "r1", phase: "ALIGN", summary: "s",
    traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
    decisions: [],
    globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false },
    coverage: { addressed: [], dropped: [] }
  }));
  return p;
}

test("render-digest then approve advances the ALIGN human gate", () => {
  const root = tmpProject();
  jam(root, ["start", "x", "--run-id", "r1"]);
  const dpath = writeDigest(root);

  const early = jam(root, ["approve", "ALIGN"]);
  assert.notEqual(early.status, 0);
  assert.match(early.stderr, /digest not rendered/);

  const rendered = jam(root, ["render-digest", "ALIGN", "--file", dpath]);
  assert.equal(rendered.status, 0);

  const approved = jam(root, ["approve", "ALIGN"]);
  assert.equal(approved.status, 0);
  assert.match(jam(root, ["status"]).stdout, /ALIGN: human\/approved/);
});

test("render-digest rejects an invalid digest file", () => {
  const root = tmpProject();
  jam(root, ["start", "x", "--run-id", "r1"]);
  const bad = path.join(root, "bad.json");
  fs.writeFileSync(bad, JSON.stringify({ summary: "missing detectors" }));
  const r = jam(root, ["render-digest", "ALIGN", "--file", bad]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /invalid digest/);
});

test("add-gate then evidence passes an auto gate only on exit 0", () => {
  const root = tmpProject();
  jam(root, ["start", "x", "--run-id", "r1"]);
  jam(root, ["add-gate", "sprint-0", "--mode", "auto"]);

  const fail1 = jam(root, ["evidence", "sprint-0", "--sprint", "s0", "--cmd", "exit 1"]);
  assert.equal(fail1.status, 0);
  assert.match(jam(root, ["status"]).stdout, /sprint-0: auto\/pending/);

  jam(root, ["evidence", "sprint-0", "--sprint", "s0", "--cmd", "exit 0"]);
  assert.match(jam(root, ["status"]).stdout, /sprint-0: auto\/evidence-passed/);
});

test("steer records a durable directive shown in status", () => {
  const root = tmpProject();
  jam(root, ["start", "x", "--run-id", "r1"]);
  const r = jam(root, ["steer", "stay within the existing module boundaries"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /d1/);
  assert.match(jam(root, ["status"]).stdout, /active directives: d1/);
});

test("cancel clears the active run so status reports none", () => {
  const root = tmpProject();
  jam(root, ["start", "x", "--run-id", "r1"]);
  const r = jam(root, ["cancel"]);
  assert.equal(r.status, 0);
  const s = jam(root, ["status"]);
  assert.notEqual(s.status, 0);
  assert.match(s.stderr + s.stdout, /no active jam run/i);
});
