import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";
import { ledgerPath } from "../plugins/jam/scripts/lib/ledger.mjs";
import { runDir, runsRoot } from "../plugins/jam/scripts/lib/paths.mjs";
import { deriveNextAction } from "../plugins/jam/scripts/lib/resume.mjs";
import { readState, statePath } from "../plugins/jam/scripts/lib/state.mjs";
import { runJam as jam } from "./helpers/jam-main.mjs";

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jam-next-init-"));
}

test("jam next prints exactly one derived next-action line and is read-only", async () => {
  const root = tmpProject();
  createRun({ projectRoot: root, runId: "r1", topic: "x", mode: "repair", now: "t0" });
  const dir = runDir(root, "r1");
  const state = readState(dir);
  const expected = `next: ${deriveNextAction(state).message}\n`;
  const beforeState = fs.readFileSync(statePath(dir));
  const beforeLedger = fs.readFileSync(ledgerPath(dir));

  const r = await jam(root, ["next"]);

  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  assert.equal(r.stdout, expected);
  assert.deepEqual(fs.readFileSync(statePath(dir)), beforeState);
  assert.deepEqual(fs.readFileSync(ledgerPath(dir)), beforeLedger);
});

test("jam next with no active run exits 1 with start guidance", async () => {
  const r = await jam(tmpProject(), ["next"]);

  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /jam diagnose/);
  assert.match(r.stderr, /jam start/);
});

test("jam init writes the goal template, prints doctor and first-command guidance, and creates no run state", async () => {
  const root = tmpProject();

  const r = await jam(root, ["init"]);

  assert.ok(r.status === 0 || r.status === 1, `doctor-dependent exit: ${r.status}`);
  const goal = path.join(root, "jam-goal.md");
  assert.equal(fs.existsSync(goal), true);
  const text = fs.readFileSync(goal, "utf8");
  assert.ok(text.includes("# Goal"));
  assert.ok(text.includes('# What "done" means'));
  assert.match(r.stdout, /doctor:/);
  assert.match(r.stdout, /roles:/);
  assert.match(r.stdout, /jam diagnose/);
  assert.match(r.stdout, /jam start/);
});

test("jam init again never overwrites the generated jam-goal.md", async () => {
  const root = tmpProject();
  const first = await jam(root, ["init"]);
  assert.ok(first.status === 0 || first.status === 1, `doctor-dependent exit: ${first.status}`);
  const goal = path.join(root, "jam-goal.md");
  const original = fs.readFileSync(goal, "utf8");

  const second = await jam(root, ["init"]);

  assert.ok(second.status === 0 || second.status === 1, `doctor-dependent exit: ${second.status}`);
  assert.match(second.stdout, /jam-goal\.md exists — left untouched/);
  assert.equal(fs.readFileSync(goal, "utf8"), original);
});

test("jam init never overwrites an existing handwritten jam-goal.md", async () => {
  const root = tmpProject();
  const goal = path.join(root, "jam-goal.md");
  const original = "# Existing goal\n\nkeep this exact text\n";
  fs.writeFileSync(goal, original);

  const r = await jam(root, ["init"]);

  assert.ok(r.status === 0 || r.status === 1, `doctor-dependent exit: ${r.status}`);
  assert.match(r.stdout, /jam-goal\.md exists — left untouched/);
  assert.equal(fs.readFileSync(goal, "utf8"), original);
});

test("jam init does not create or modify loop-run state", async () => {
  const root = tmpProject();
  const loopRuns = runsRoot(root);
  fs.mkdirSync(loopRuns, { recursive: true });
  const sentinel = path.join(loopRuns, "sentinel.txt");
  fs.writeFileSync(sentinel, "unchanged\n");
  const before = fs.readFileSync(sentinel);

  const r = await jam(root, ["init"]);

  assert.ok(r.status === 0 || r.status === 1, `doctor-dependent exit: ${r.status}`);
  assert.deepEqual(fs.readFileSync(sentinel), before);
  assert.equal(fs.existsSync(path.join(loopRuns, "ACTIVE")), false);
});
