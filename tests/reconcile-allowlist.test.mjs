import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { openTurnWorktree, reconcileTurnWorktree, discardTurnWorktree } from "../plugins/jam/scripts/lib/worktree.mjs";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
const FAKE_CODEX = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));

function jam(cwd, args, env = {}) {
  const out = path.join(os.tmpdir(), `jam-reconcile-cli-out-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const err = path.join(os.tmpdir(), `jam-reconcile-cli-err-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const outFd = fs.openSync(out, "w");
  const errFd = fs.openSync(err, "w");
  try {
    const r = spawnSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", outFd, errFd]
    });
    return { ...r, stdout: fs.readFileSync(out, "utf8"), stderr: fs.readFileSync(err, "utf8") };
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
    try { fs.rmSync(out, { force: true }); } catch {}
    try { fs.rmSync(err, { force: true }); } catch {}
  }
}

function writeJSON(p, value) {
  fs.writeFileSync(p, JSON.stringify(value));
  return p;
}

function digestObj() {
  return {
    runId: "r1",
    phase: "DIAGNOSE",
    summary: "diagnosed",
    traceToArchitecture: { componentsTouched: ["src/fix.js"], gapFromAgreed: null },
    decisions: [],
    globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false },
    coverage: { addressed: [], dropped: [] }
  };
}

function codexHomeWithSession(sessionId) {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "jam-proof-codex-home-"));
  fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "sessions", `rollout-2026-06-16T00-00-00-${sessionId}.jsonl`),
    `{"type":"session_meta","payload":{"id":"${sessionId}"}}\n`
  );
  return codexHome;
}

function gitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jam-reconcile-allow-"));
  const g = (...a) => spawnSync("git", ["-C", root, ...a], { encoding: "utf8" });
  g("init", "-q");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  g("config", "commit.gpgsign", "false");
  fs.mkdirSync(path.join(root, "allowed"), { recursive: true });
  fs.mkdirSync(path.join(root, "other"), { recursive: true });
  fs.writeFileSync(path.join(root, "allowed", "keep.txt"), "allowed baseline\n");
  fs.writeFileSync(path.join(root, "allowed", "a.txt"), "rename me\n");
  fs.writeFileSync(path.join(root, "other", "creep.txt"), "other baseline\n");
  g("add", "-A");
  g("commit", "-qm", "init");
  return { root, g };
}

function openTurn(root, token = "s1#1") {
  return openTurnWorktree({ repoRoot: root, sprintId: "s1", token });
}

function cleanup(root, worktreePath) {
  discardTurnWorktree({ repoRoot: root, worktreePath });
}

test("strip mode keeps in-scope edits and drops out-of-scope edits", () => {
  const { root } = gitRepo();
  const { worktreePath, baselineRef } = openTurn(root);
  try {
    fs.writeFileSync(path.join(worktreePath, "allowed", "keep.txt"), "allowed turn edit\n");
    fs.writeFileSync(path.join(worktreePath, "other", "creep.txt"), "out of scope edit\n");

    const r = reconcileTurnWorktree({ repoRoot: root, worktreePath, baselineRef, allowedPaths: ["allowed/**"] });

    assert.equal(r.applied, true);
    assert.deepEqual(r.kept, ["allowed/keep.txt"]);
    assert.deepEqual(r.dropped, ["other/creep.txt"]);
    assert.equal(fs.readFileSync(path.join(root, "allowed", "keep.txt"), "utf8"), "allowed turn edit\n");
    assert.equal(fs.readFileSync(path.join(root, "other", "creep.txt"), "utf8"), "other baseline\n");
  } finally {
    cleanup(root, worktreePath);
  }
});

test("proof-run mirror: CLI reconcile strips creep outside a sprint allowedPaths and verifies the fix", () => {
  const { root, g } = gitRepo();
  const worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jam-proof-wt-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "fix.js"), "export const value = 'baseline';\n");
  fs.writeFileSync(path.join(root, "src", "creep.js"), "export const creep = 'untouched';\n");
  assert.equal(g("add", "-A").status, 0);
  assert.equal(g("commit", "-qm", "add proof files").status, 0);

  assert.equal(jam(root, ["diagnose", "fix", "--goal", writeJSON(path.join(root, "goal.json"), { goal: "fix only" }), "--run-id", "r1"]).status, 0);
  assert.equal(jam(root, ["render-digest", "DIAGNOSE", "--file", writeJSON(path.join(root, "digest.json"), digestObj())]).status, 0);
  assert.equal(jam(root, ["approve", "DIAGNOSE"]).status, 0);
  assert.equal(jam(root, ["advance"]).status, 0);
  assert.equal(jam(root, ["verify", "--file", writeJSON(path.join(root, "verdict.json"), { unresolvedBlockers: 0 })]).status, 0);
  assert.equal(jam(root, ["approve", "VERIFY"]).status, 0);
  assert.equal(jam(root, ["advance"]).status, 0);
  assert.equal(jam(root, ["plan", "--file", writeJSON(path.join(root, "plan.json"), {
    verifyCmd: "node -e \"const fs=require('fs'); process.exit(fs.readFileSync('src/fix.js','utf8').includes('fixed') ? 0 : 1)\"",
    sprints: [{ id: "fix-1", title: "fix allowed file", acceptanceCriteria: "src/fix.js contains the fix", allowedPaths: ["src/fix.js"] }]
  })]).status, 0);
  assert.equal(jam(root, ["approve", "PLAN"]).status, 0);
  assert.equal(jam(root, ["advance"]).status, 0);
  assert.equal(jam(root, ["sprint", "fix-1", "--start"]).status, 0);

  const sessionId = "visualmind-proof-run";
  const promptFile = path.join(root, "prompt.md");
  fs.writeFileSync(promptFile, "Implement the fix in src/fix.js only.\n");
  const run = jam(root, ["codex-run", "--sprint", "fix-1", "--prompt-file", promptFile, "--out-dir", path.join(root, "codex-out")], {
    JAM_CODEX_BIN: FAKE_CODEX,
    JAM_FAKE_SESSION_ID: sessionId,
    CODEX_HOME: codexHomeWithSession(sessionId),
    JAM_FAKE_EDIT: "src/fix.js:fixed",
    JAM_FAKE_EDIT2: "src/creep.js:scope creep",
    JAM_WORKTREE_ROOT: worktreeRoot
  });

  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /scope-stripped 1 out-of-allowlist path\(s\).*src\/creep\.js/);
  assert.match(fs.readFileSync(path.join(root, "src", "fix.js"), "utf8"), /fixed/);
  assert.equal(fs.readFileSync(path.join(root, "src", "creep.js"), "utf8"), "export const creep = 'untouched';\n");

  const ledger = fs.readFileSync(path.join(root, "docs", "superpowers", "loop-runs", "r1", "ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const stripped = ledger.find((entry) => entry.type === "turn-scope-stripped");
  assert.ok(stripped);
  assert.deepEqual(stripped.dropped, ["src/creep.js"]);
  assert.deepEqual(stripped.kept, ["src/fix.js"]);

  const verify = jam(root, ["sprint", "fix-1", "--verify"]);
  assert.equal(verify.status, 0, verify.stdout + verify.stderr);
  assert.match(verify.stdout, /sprint fix-1 verify: exit 0/);

  const done = jam(root, ["sprint", "fix-1", "--done"]);
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.match(done.stdout, /sprint fix-1: done/);
});

test("absent allowlist preserves original reconcile behavior", () => {
  const { root } = gitRepo();
  const { worktreePath, baselineRef } = openTurn(root);
  try {
    fs.writeFileSync(path.join(worktreePath, "allowed", "keep.txt"), "allowed turn edit\n");
    fs.writeFileSync(path.join(worktreePath, "other", "creep.txt"), "out of scope edit\n");

    const r = reconcileTurnWorktree({ repoRoot: root, worktreePath, baselineRef, allowedPaths: undefined });

    assert.equal(r.applied, true);
    assert.deepEqual(r.dropped, []);
    assert.equal(fs.readFileSync(path.join(root, "allowed", "keep.txt"), "utf8"), "allowed turn edit\n");
    assert.equal(fs.readFileSync(path.join(root, "other", "creep.txt"), "utf8"), "out of scope edit\n");
  } finally {
    cleanup(root, worktreePath);
  }
});

test("all out-of-scope edits reconcile as an empty in-scope patch with dropped paths", () => {
  const { root } = gitRepo();
  const { worktreePath, baselineRef } = openTurn(root);
  try {
    fs.writeFileSync(path.join(worktreePath, "other", "creep.txt"), "out of scope edit\n");

    const r = reconcileTurnWorktree({ repoRoot: root, worktreePath, baselineRef, allowedPaths: ["allowed/**"] });

    assert.equal(r.applied, false);
    assert.equal(r.empty, true);
    assert.deepEqual(r.kept, []);
    assert.deepEqual(r.dropped, ["other/creep.txt"]);
    assert.equal(fs.readFileSync(path.join(root, "other", "creep.txt"), "utf8"), "other baseline\n");
  } finally {
    cleanup(root, worktreePath);
  }
});

test("drift still fires on kept paths under strip mode", () => {
  const { root } = gitRepo();
  const { worktreePath, baselineRef } = openTurn(root);
  try {
    fs.writeFileSync(path.join(worktreePath, "allowed", "keep.txt"), "allowed turn edit\n");
    fs.writeFileSync(path.join(worktreePath, "other", "creep.txt"), "out of scope edit\n");
    fs.writeFileSync(path.join(root, "allowed", "keep.txt"), "human drift\n");

    const r = reconcileTurnWorktree({ repoRoot: root, worktreePath, baselineRef, allowedPaths: ["allowed/**"] });

    assert.equal(r.applied, false);
    assert.equal(r.drift, true);
    assert.equal(r.path, "allowed/keep.txt");
    assert.deepEqual(r.kept, ["allowed/keep.txt"]);
    assert.deepEqual(r.dropped, ["other/creep.txt"]);
    assert.equal(fs.readFileSync(path.join(root, "allowed", "keep.txt"), "utf8"), "human drift\n");
  } finally {
    cleanup(root, worktreePath);
  }
});

test("rename under strip mode applies as delete plus add without leaving a stale source", () => {
  const { root, g } = gitRepo();
  const { worktreePath, baselineRef } = openTurn(root);
  try {
    const gw = (...a) => spawnSync("git", ["-C", worktreePath, ...a], { encoding: "utf8" });
    const mv = gw("mv", "allowed/a.txt", "allowed/b.txt");
    assert.equal(mv.status, 0, mv.stderr);

    const r = reconcileTurnWorktree({ repoRoot: root, worktreePath, baselineRef, allowedPaths: ["allowed/**"] });

    assert.equal(r.applied, true);
    assert.deepEqual(r.kept, ["allowed/a.txt", "allowed/b.txt"]);
    assert.deepEqual(r.dropped, []);
    assert.equal(fs.existsSync(path.join(root, "allowed", "a.txt")), false);
    assert.equal(fs.readFileSync(path.join(root, "allowed", "b.txt"), "utf8"), "rename me\n");
    assert.match(g("status", "--short").stdout, /^ D allowed\/a\.txt\n\?\? allowed\/b\.txt\n?$/);
  } finally {
    cleanup(root, worktreePath);
  }
});
