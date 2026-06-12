import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readActiveRunId } from "../plugins/jam/scripts/lib/paths.mjs";
import { runJam as jam } from "./helpers/jam-main.mjs";

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jam-cli-"));
}

test("start creates a run, sets ACTIVE pointer, prints the run id", async () => {
  const root = tmpProject();
  const r = await jam(root, ["start", "build a thing", "--run-id", "r1"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /r1/);
  assert.equal(readActiveRunId(root), "r1");
});

test("status reports phase and the ALIGN gate", async () => {
  const root = tmpProject();
  await jam(root, ["start", "x", "--run-id", "r1"]);
  const r = await jam(root, ["status"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ALIGN/);
  assert.match(r.stdout, /pending/);
});

test("status with no active run exits non-zero with a clear message", async () => {
  const root = tmpProject();
  const r = await jam(root, ["status"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /no active jam run/i);
});

test("unknown subcommand exits non-zero", async () => {
  const root = tmpProject();
  const r = await jam(root, ["frobnicate"]);
  assert.notEqual(r.status, 0);
});

test("a value-flag with no value does not swallow the next flag", async () => {
  const root = tmpProject();
  await jam(root, ["start", "x", "--run-id", "r1"]);
  // --file has no value (followed by another flag); render-digest must reject, not crash
  const r = await jam(root, ["render-digest", "ALIGN", "--file", "--mode", "auto"]);
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

test("render-digest then approve advances the ALIGN human gate", async () => {
  const root = tmpProject();
  await jam(root, ["start", "x", "--run-id", "r1"]);
  const dpath = writeDigest(root);

  const early = await jam(root, ["approve", "ALIGN"]);
  assert.notEqual(early.status, 0);
  assert.match(early.stderr, /digest not rendered/);

  const rendered = await jam(root, ["render-digest", "ALIGN", "--file", dpath]);
  assert.equal(rendered.status, 0);

  const approved = await jam(root, ["approve", "ALIGN"]);
  assert.equal(approved.status, 0);
  assert.match((await jam(root, ["status"])).stdout, /ALIGN: human\/approved/);
});

test("render-digest rejects an invalid digest file", async () => {
  const root = tmpProject();
  await jam(root, ["start", "x", "--run-id", "r1"]);
  const bad = path.join(root, "bad.json");
  fs.writeFileSync(bad, JSON.stringify({ summary: "missing detectors" }));
  const r = await jam(root, ["render-digest", "ALIGN", "--file", bad]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /invalid digest/);
});

test("add-gate then evidence passes an auto gate only on exit 0", async () => {
  const root = tmpProject();
  await jam(root, ["start", "x", "--run-id", "r1"]);
  await jam(root, ["add-gate", "sprint-0", "--mode", "auto"]);

  const fail1 = await jam(root, ["evidence", "sprint-0", "--sprint", "s0", "--cmd", "exit 1"]);
  assert.equal(fail1.status, 0);
  assert.match((await jam(root, ["status"])).stdout, /sprint-0: auto\/pending/);

  await jam(root, ["evidence", "sprint-0", "--sprint", "s0", "--cmd", "exit 0"]);
  assert.match((await jam(root, ["status"])).stdout, /sprint-0: auto\/evidence-passed/);
});

test("steer records a durable directive shown in status", async () => {
  const root = tmpProject();
  await jam(root, ["start", "x", "--run-id", "r1"]);
  const r = await jam(root, ["steer", "stay within the existing module boundaries"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /d1/);
  assert.match((await jam(root, ["status"])).stdout, /active directives: d1/);
});

test("cancel clears the active run so status reports none", async () => {
  const root = tmpProject();
  await jam(root, ["start", "x", "--run-id", "r1"]);
  const r = await jam(root, ["cancel", "--confirm", "r1"]);
  assert.equal(r.status, 0);
  const s = await jam(root, ["status"]);
  assert.notEqual(s.status, 0);
  assert.match(s.stderr + s.stdout, /no active jam run/i);
});

test("a full run can be driven end-to-end through the CLI", async () => {
  const root = tmpProject();
  assert.equal((await jam(root, ["start", "demo", "--run-id", "r1"])).status, 0);
  const dpath = writeDigest(root);
  assert.equal((await jam(root, ["render-digest", "ALIGN", "--file", dpath])).status, 0);
  assert.equal((await jam(root, ["approve", "ALIGN"])).status, 0);
  assert.equal((await jam(root, ["add-gate", "sprint-0", "--mode", "auto"])).status, 0);
  assert.equal((await jam(root, ["evidence", "sprint-0", "--sprint", "s0", "--cmd", "exit 0"])).status, 0);
  const status = (await jam(root, ["status"])).stdout;
  assert.match(status, /ALIGN: human\/approved/);
  assert.match(status, /sprint-0: auto\/evidence-passed/);
});
