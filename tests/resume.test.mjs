import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";
import { ledgerPath } from "../plugins/jam/scripts/lib/ledger.mjs";
import { runDir } from "../plugins/jam/scripts/lib/paths.mjs";
import { readState, statePath, writeState } from "../plugins/jam/scripts/lib/state.mjs";
import { deriveNextAction } from "../plugins/jam/scripts/lib/resume.mjs";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));

const base = () => ({ mode: "repair", phase: "IMPLEMENT", gates: {}, plan: { verifyCmd: "true", sprints: [] } });

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jam-resume-"));
}

function jam(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

test("priority 1: open isolated turn -> reconcile hint", () => {
  const s = base();
  s.plan.sprints = [{ id: "a", status: "in-progress", provenance: "planned", turn: { token: "a#1", status: "open", isolated: true } }];
  s.gates["sprint-a"] = { mode: "auto", status: "pending", approveFrom: "rendered" };
  assert.match(deriveNextAction(s).message, /jam reconcile --sprint a/);
});

test("priority 2: evidence-passed in-progress sprint -> --done hint", () => {
  const s = base();
  s.plan.sprints = [{ id: "a", status: "in-progress", provenance: "planned" }];
  s.gates["sprint-a"] = { mode: "auto", status: "evidence-passed", approveFrom: "rendered" };
  assert.match(deriveNextAction(s).message, /sprint a --done/);
});

test("priority 3: in-progress sprint without evidence -> --verify hint", () => {
  const s = base();
  s.plan.sprints = [{ id: "a", status: "in-progress", provenance: "planned" }];
  s.gates["sprint-a"] = { mode: "auto", status: "pending", approveFrom: "rendered" };
  assert.match(deriveNextAction(s).message, /sprint a --verify/);
});

test("priority 4: blocking gates -> per-approveFrom hints incl. rejected reason", () => {
  const m = (gates) => deriveNextAction({ mode: "repair", phase: "DIAGNOSE", gates, plan: { sprints: [] } }).message;
  assert.match(m({ DIAGNOSE: { mode: "human", status: "pending", approveFrom: "rendered" } }), /render-digest/);
  assert.match(m({ VERIFY: { mode: "human", status: "pending", approveFrom: "verified" } }), /jam verify --file/);
  assert.match(m({ PLAN: { mode: "human", status: "pending", approveFrom: "planned" } }), /record the plan/i);
  assert.match(m({ "action-x": { mode: "human", status: "pending", approveFrom: "ratified" } }), /jam ratify/);
  assert.match(m({ DIAGNOSE: { mode: "human", status: "rejected", rejectedReason: "redo", approveFrom: "rendered" } }), /rejected: redo/);
  assert.match(m({ DIAGNOSE: { mode: "human", status: "rendered", approveFrom: "rendered" } }), /jam:approve DIAGNOSE/);
});

test("terminal action gates (denied/ratified) never shadow the real next action", () => {
  const s = base();
  s.phase = "DIAGNOSE";
  s.gates = {
    "action-x": { mode: "human", status: "rejected", approveFrom: "ratified" },
    DIAGNOSE: { mode: "human", status: "rendered", approveFrom: "rendered" },
  };
  s.actions = [{ id: "x", status: "denied", irreversible: true }];
  assert.match(deriveNextAction(s).message, /jam:approve DIAGNOSE/);
  s.actions = [{ id: "x", status: "proposed", irreversible: true }];
  s.gates["action-x"].status = "pending";
  assert.match(deriveNextAction(s).message, /jam ratify/);
});

test("priority 5/6: all sprints done -> advance; FINISH -> complete", () => {
  const s = base();
  s.plan.sprints = [{ id: "a", status: "done", provenance: "planned", codexSessions: [{ transcriptPath: "/x" }] }];
  s.gates["sprint-a"] = { mode: "auto", status: "evidence-passed", approveFrom: "rendered" };
  assert.match(deriveNextAction(s).message, /jam advance/);
  assert.match(deriveNextAction({ ...base(), phase: "FINISH" }).message, /complete.*jam report/i);
});

test("jam resume is read-only for state.json and ledger.jsonl", () => {
  const root = tmpProject();
  createRun({ projectRoot: root, runId: "r1", topic: "x", mode: "repair", now: "t0" });
  const dir = runDir(root, "r1");
  const st = readState(dir);
  st.abandonedWorktrees = [{ repoRoot: root, worktreePath: path.join(root, "missing-worktree") }];
  writeState(dir, st);

  const beforeState = fs.readFileSync(statePath(dir));
  const beforeLedger = fs.readFileSync(ledgerPath(dir));
  const r = jam(root, ["resume"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /run r1/);
  assert.match(r.stdout, /next:/);
  assert.deepEqual(fs.readFileSync(statePath(dir)), beforeState);
  assert.deepEqual(fs.readFileSync(ledgerPath(dir)), beforeLedger);
});
