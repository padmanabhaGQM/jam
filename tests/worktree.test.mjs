import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isGitRepo, largeTrackedBlobs, openTurnWorktree, reconcileTurnWorktree, discardTurnWorktree } from "../plugins/jam/scripts/lib/worktree.mjs";

function gitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jam-wt-"));
  const g = (...a) => spawnSync("git", ["-C", root, ...a], { encoding: "utf8" });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t"); g("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(root, "code.txt"), "v1\n");
  g("add", "-A"); g("commit", "-qm", "init");
  return { root, g };
}

test("isGitRepo true for a git repo, false for a bare dir", () => {
  const { root } = gitRepo();
  assert.equal(isGitRepo(root), true);
  assert.equal(isGitRepo(fs.mkdtempSync(path.join(os.tmpdir(), "jam-nogit-"))), false);
});

test("openTurnWorktree snapshots dirty+untracked into a baseline and isolates them in a worktree", () => {
  const { root } = gitRepo();
  fs.writeFileSync(path.join(root, "code.txt"), "v2-dirty\n");          // tracked dirty
  fs.writeFileSync(path.join(root, "new.txt"), "untracked\n");          // untracked-not-ignored
  const { worktreePath, baselineRef } = openTurnWorktree({ repoRoot: root, sprintId: "s1", token: "s1#1" });
  assert.ok(baselineRef && baselineRef.length >= 7);
  assert.ok(!worktreePath.startsWith(root + path.sep) && worktreePath !== root);   // OUTSIDE the repo (structural isolation)
  assert.equal(fs.readFileSync(path.join(worktreePath, "code.txt"), "utf8"), "v2-dirty\n");  // dirty work seeded
  assert.equal(fs.readFileSync(path.join(worktreePath, "new.txt"), "utf8"), "untracked\n");  // untracked seeded
  // main tree untouched (still dirty, no new commit on its branch)
  assert.equal(fs.readFileSync(path.join(root, "code.txt"), "utf8"), "v2-dirty\n");
});

test("reconcileTurnWorktree applies the turn's net diff to the main tree; discard removes the worktree", () => {
  const { root } = gitRepo();
  fs.writeFileSync(path.join(root, "code.txt"), "v2-dirty\n");
  const { worktreePath, baselineRef } = openTurnWorktree({ repoRoot: root, sprintId: "s1", token: "s1#1" });
  // "Codex" edits inside the worktree
  fs.writeFileSync(path.join(worktreePath, "code.txt"), "v2-dirty\nturn-change\n");
  fs.writeFileSync(path.join(worktreePath, "added.txt"), "by-turn\n");
  const r = reconcileTurnWorktree({ repoRoot: root, worktreePath, baselineRef });
  assert.equal(r.applied, true);
  assert.equal(fs.readFileSync(path.join(root, "code.txt"), "utf8"), "v2-dirty\nturn-change\n");  // dirty + turn change
  assert.equal(fs.readFileSync(path.join(root, "added.txt"), "utf8"), "by-turn\n");
  discardTurnWorktree({ repoRoot: root, worktreePath });
  assert.equal(fs.existsSync(worktreePath), false);
});

test("reconcile refuses (drift) when the main tree changed under the turn", () => {
  const { root } = gitRepo();
  const { worktreePath, baselineRef } = openTurnWorktree({ repoRoot: root, sprintId: "s1", token: "s1#1" });
  fs.writeFileSync(path.join(worktreePath, "code.txt"), "turn-edit\n");
  fs.writeFileSync(path.join(root, "code.txt"), "human-edit-meanwhile\n");   // drift
  const r = reconcileTurnWorktree({ repoRoot: root, worktreePath, baselineRef });
  assert.equal(r.applied, false);
  assert.equal(r.drift, true);
});

test("reconcile refuses if the controller HEAD moved during the turn (shared-ref detector)", () => {
  const { root, g } = gitRepo();
  const { worktreePath, baselineRef, headAtOpen } = openTurnWorktree({ repoRoot: root, sprintId: "s1", token: "s1#1" });
  fs.writeFileSync(path.join(worktreePath, "code.txt"), "turn\n");
  // simulate the controller branch moving during the turn (a deliberate update-ref, or any HEAD move)
  fs.writeFileSync(path.join(root, "other.txt"), "x\n"); g("add", "-A"); g("commit", "-qm", "head moved");
  const r = reconcileTurnWorktree({ repoRoot: root, worktreePath, baselineRef, headAtOpen });
  assert.equal(r.headMoved, true);
  assert.notEqual(r.applied, true);
});

test("largeTrackedBlobs flags tracked files over the threshold; sparse worktree omits them", () => {
  const { root, g } = gitRepo();
  fs.writeFileSync(path.join(root, "big.bin"), Buffer.alloc(6 * 1024 * 1024, 1));   // 6 MB tracked
  g("add", "-A"); g("commit", "-qm", "big");
  const head = g("rev-parse", "HEAD").stdout.trim();
  assert.ok(largeTrackedBlobs(root, head, 5 * 1024 * 1024).includes("big.bin"));
  const { worktreePath, baselineRef } = openTurnWorktree({ repoRoot: root, sprintId: "s1", token: "s1#1" });
  assert.equal(fs.existsSync(path.join(worktreePath, "big.bin")), false);          // excluded from worktree
  assert.equal(fs.existsSync(path.join(root, "big.bin")), true);                   // present in main tree
  // REGRESSION: reconciling a code-only turn must NOT delete the sparse-excluded big blob from the main tree
  fs.writeFileSync(path.join(worktreePath, "code.txt"), "v1\nturn\n");
  const gw = (...a) => spawnSync("git", ["-C", worktreePath, ...a], { encoding: "utf8" });
  gw("add", "-A");
  assert.doesNotMatch(gw("diff", "--cached", "--name-status", baselineRef).stdout, /^D\s+big\.bin/m);   // no spurious deletion staged
  const r = reconcileTurnWorktree({ repoRoot: root, worktreePath, baselineRef });
  assert.equal(r.applied, true);
  assert.equal(fs.existsSync(path.join(root, "big.bin")), true);                   // still present after reconcile
  assert.match(fs.readFileSync(path.join(root, "code.txt"), "utf8"), /turn/);      // code change applied
});

test("reconcile NEVER lands jam internals (loop-runs/ACTIVE) even when tracked — closes the ACTIVE-clobber vector", () => {
  const { root, g } = gitRepo();
  fs.mkdirSync(path.join(root, "docs", "superpowers", "loop-runs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "superpowers", "loop-runs", "ACTIVE"), "real-run\n");
  g("add", "-A"); g("commit", "-qm", "track loop-runs");                            // simulate a target repo that does NOT ignore loop-runs
  const { worktreePath, baselineRef } = openTurnWorktree({ repoRoot: root, sprintId: "s1", token: "s1#1" });
  fs.writeFileSync(path.join(worktreePath, "code.txt"), "v1\nturn\n");
  fs.writeFileSync(path.join(worktreePath, "docs", "superpowers", "loop-runs", "ACTIVE"), "HIJACKED\n");   // a turn running `jam` tries to clobber ACTIVE
  const r = reconcileTurnWorktree({ repoRoot: root, worktreePath, baselineRef });
  assert.equal(r.applied, true);
  assert.match(fs.readFileSync(path.join(root, "code.txt"), "utf8"), /turn/);       // code landed
  assert.equal(fs.readFileSync(path.join(root, "docs", "superpowers", "loop-runs", "ACTIVE"), "utf8"), "real-run\n");  // ACTIVE untouched
});
