import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
const FAKE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
function jam(cwd, args, env = {}) {
  const out = path.join(os.tmpdir(), `jam-cli-out-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const err = path.join(os.tmpdir(), `jam-cli-err-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const outFd = fs.openSync(out, "w");
  const errFd = fs.openSync(err, "w");
  try {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", outFd, errFd] });
    return { ...r, stdout: fs.readFileSync(out, "utf8"), stderr: fs.readFileSync(err, "utf8") };
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
    try { fs.rmSync(out, { force: true }); } catch {}
    try { fs.rmSync(err, { force: true }); } catch {}
  }
}
function writeJSON(p, o) { fs.writeFileSync(p, JSON.stringify(o)); return p; }

function digestObj() {
  return {
    runId: "r1",
    phase: "DIAGNOSE",
    summary: "s",
    traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
    decisions: [],
    globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false },
    coverage: { addressed: [], dropped: [] }
  };
}

// A git repo with a committed baseline + a dirty file, driven to IMPLEMENT with one sprint.
function gitRepoAtImplement() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jam-ti-"));
  const g = (...a) => spawnSync("git", ["-C", root, ...a], { encoding: "utf8" });
  g("init", "-q");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  g("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(root, "app.txt"), "baseline\n");
  g("add", "-A");
  g("commit", "-qm", "init");
  fs.writeFileSync(path.join(root, "dirty.txt"), "human-WIP\n");
  jam(root, ["diagnose", "fix", "--goal", writeJSON(path.join(root, "g.txt"), { x: 1 }), "--run-id", "r1"]);
  jam(root, ["render-digest", "DIAGNOSE", "--file", writeJSON(path.join(root, "d.json"), digestObj())]);
  jam(root, ["approve", "DIAGNOSE"]);
  jam(root, ["advance"]);
  jam(root, ["verify", "--file", writeJSON(path.join(root, "v.json"), { unresolvedBlockers: 0 })]);
  jam(root, ["approve", "VERIFY"]);
  jam(root, ["advance"]);
  jam(root, ["plan", "--file", writeJSON(path.join(root, "plan.json"), { verifyCmd: "true", sprints: [{ id: "fix-1", title: "t", acceptanceCriteria: "ac" }] })]);
  jam(root, ["approve", "PLAN"]);
  jam(root, ["advance"]);
  return { root, g, worktreeRoot: fs.mkdtempSync(path.join(os.tmpdir(), "jam-ti-wt-")) };
}

function nonGitAtImplement() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jam-ti-nongit-"));
  jam(root, ["diagnose", "fix", "--goal", writeJSON(path.join(root, "g.txt"), { x: 1 }), "--run-id", "r1"]);
  jam(root, ["render-digest", "DIAGNOSE", "--file", writeJSON(path.join(root, "d.json"), digestObj())]);
  jam(root, ["approve", "DIAGNOSE"]);
  jam(root, ["advance"]);
  jam(root, ["verify", "--file", writeJSON(path.join(root, "v.json"), { unresolvedBlockers: 0 })]);
  jam(root, ["approve", "VERIFY"]);
  jam(root, ["advance"]);
  jam(root, ["plan", "--file", writeJSON(path.join(root, "plan.json"), { verifyCmd: "true", sprints: [{ id: "fix-1", title: "t", acceptanceCriteria: "ac" }] })]);
  jam(root, ["approve", "PLAN"]);
  jam(root, ["advance"]);
  return root;
}

function codexHomeWithSession(sessionId) {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "jam-ch-"));
  fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(codexHome, "sessions", `rollout-2026-06-11T00-00-00-${sessionId}.jsonl`), `{"type":"session_meta","payload":{"id":"${sessionId}"}}\n`);
  return codexHome;
}

test("codex-run --sprint runs the turn in an isolated worktree; main tree HEAD/files unchanged until reconcile", () => {
  const { root, g, worktreeRoot } = gitRepoAtImplement();
  const headBefore = g("rev-parse", "HEAD").stdout.trim();
  jam(root, ["sprint", "fix-1", "--start"]);
  const pf = path.join(root, "p.md");
  fs.writeFileSync(pf, "edit app.txt");
  const sid = "jam-fake-ti";
  const codexHome = codexHomeWithSession(sid);
  const run = jam(root, ["codex-run", "--sprint", "fix-1", "--prompt-file", pf, "--out-dir", path.join(root, "cx")],
    { JAM_CODEX_BIN: FAKE, JAM_FAKE_SESSION_ID: sid, CODEX_HOME: codexHome, JAM_FAKE_EDIT: "app.txt:turn-made-this", JAM_WORKTREE_ROOT: worktreeRoot });
  assert.equal(run.status, 0, run.stderr);
  assert.match(fs.readFileSync(path.join(root, "app.txt"), "utf8"), /turn-made-this/);
  assert.equal(fs.readFileSync(path.join(root, "dirty.txt"), "utf8"), "human-WIP\n");
  assert.equal(g("rev-parse", "HEAD").stdout.trim(), headBefore);
});

test("a superseded OPEN turn never lands; only the live turn reconciles", () => {
  const { root, worktreeRoot } = gitRepoAtImplement();
  jam(root, ["sprint", "fix-1", "--start"]);
  const pf = path.join(root, "p.md");
  fs.writeFileSync(pf, "go");
  const ch = fs.mkdtempSync(path.join(os.tmpdir(), "jam-ch-"));
  fs.mkdirSync(path.join(ch, "sessions"), { recursive: true });
  const run1 = jam(root, ["codex-run", "--sprint", "fix-1", "--prompt-file", pf, "--out-dir", path.join(root, "cx1"), "--timeout", "8000"],
    { JAM_CODEX_BIN: FAKE, JAM_FAKE_MODE: "interrupt", JAM_FAKE_SESSION_ID: "ti-1", CODEX_HOME: ch, JAM_FAKE_EDIT: "app.txt:from-turn-1", JAM_WORKTREE_ROOT: worktreeRoot });
  assert.equal(run1.status, 0, run1.stderr);
  const sid2 = "ti-2";
  fs.writeFileSync(path.join(ch, "sessions", `rollout-2026-06-11T00-00-00-${sid2}.jsonl`), `{"type":"session_meta","payload":{"id":"${sid2}"}}\n`);
  const run2 = jam(root, ["codex-run", "--sprint", "fix-1", "--prompt-file", pf, "--out-dir", path.join(root, "cx2")],
    { JAM_CODEX_BIN: FAKE, JAM_FAKE_SESSION_ID: sid2, CODEX_HOME: ch, JAM_FAKE_EDIT: "app.txt:from-turn-2", JAM_WORKTREE_ROOT: worktreeRoot });
  assert.equal(run2.status, 0, run2.stderr);
  const ledger = fs.readFileSync(path.join(root, "docs", "superpowers", "loop-runs", "r1", "ledger.jsonl"), "utf8");
  assert.match(ledger, /"type":"turn-discarded"[^\n]*"reason":"superseded"/);
  const app = fs.readFileSync(path.join(root, "app.txt"), "utf8");
  assert.match(app, /from-turn-2/);
  assert.doesNotMatch(app, /from-turn-1/);
});

test("non-git project root falls back to in-place with a visible warning + turn-unisolated ledger", () => {
  const root = nonGitAtImplement();
  const sid = "jam-fake-nongit";
  const codexHome = codexHomeWithSession(sid);
  jam(root, ["sprint", "fix-1", "--start"]);
  const pf = path.join(root, "p.md");
  fs.writeFileSync(pf, "edit local.txt");
  const run = jam(root, ["codex-run", "--sprint", "fix-1", "--prompt-file", pf, "--out-dir", path.join(root, "cx")],
    { JAM_CODEX_BIN: FAKE, JAM_FAKE_SESSION_ID: sid, CODEX_HOME: codexHome, JAM_FAKE_EDIT: "local.txt:turn-made-this" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /isolation OFF/);
  const ledger = fs.readFileSync(path.join(root, "docs", "superpowers", "loop-runs", "r1", "ledger.jsonl"), "utf8");
  assert.match(ledger, /"type":"turn-unisolated"/);
  assert.match(fs.readFileSync(path.join(root, "local.txt"), "utf8"), /turn-made-this/);
  const verify = jam(root, ["sprint", "fix-1", "--verify"]);
  assert.equal(verify.status, 0, verify.stderr);
  const done = jam(root, ["sprint", "fix-1", "--done"]);
  assert.equal(done.status, 0, done.stderr);
});
