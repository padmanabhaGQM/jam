import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
const FAKE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));

function tmp(prefix = "jam-allow-cli-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function jam(cwd, args, env = {}) {
  const out = path.join(os.tmpdir(), `jam-allow-out-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const err = path.join(os.tmpdir(), `jam-allow-err-${process.pid}-${Math.random().toString(36).slice(2)}`);
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

function writeJSON(p, o) {
  fs.writeFileSync(p, JSON.stringify(o));
  return p;
}

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

function gitRepoAtImplement({ allowedPaths = ["allowed/**"] } = {}) {
  const root = tmp();
  const g = (...a) => spawnSync("git", ["-C", root, ...a], { encoding: "utf8" });
  g("init", "-q");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  g("config", "commit.gpgsign", "false");
  fs.mkdirSync(path.join(root, "allowed"), { recursive: true });
  fs.mkdirSync(path.join(root, "other"), { recursive: true });
  fs.writeFileSync(path.join(root, "allowed", "keep.txt"), "base-allowed\n");
  fs.writeFileSync(path.join(root, "other", "drop.txt"), "base-other\n");
  g("add", "-A");
  g("commit", "-qm", "init");

  jam(root, ["diagnose", "fix", "--goal", writeJSON(path.join(root, "g.txt"), { x: 1 }), "--run-id", "r1"]);
  jam(root, ["render-digest", "DIAGNOSE", "--file", writeJSON(path.join(root, "d.json"), digestObj())]);
  jam(root, ["approve", "DIAGNOSE"]);
  jam(root, ["advance"]);
  jam(root, ["verify", "--file", writeJSON(path.join(root, "v.json"), { unresolvedBlockers: 0 })]);
  jam(root, ["approve", "VERIFY"]);
  jam(root, ["advance"]);
  jam(root, ["plan", "--file", writeJSON(path.join(root, "plan.json"), {
    verifyCmd: "true",
    sprints: [{ id: "fix-1", title: "t", acceptanceCriteria: "ac", allowedPaths }]
  })]);
  jam(root, ["approve", "PLAN"]);
  jam(root, ["advance"]);
  return { root, g, worktreeRoot: tmp("jam-allow-wt-") };
}

function codexHomeWithSession(sessionId) {
  const codexHome = tmp("jam-allow-ch-");
  fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "sessions", `rollout-2026-06-16T00-00-00-${sessionId}.jsonl`),
    `{"type":"session_meta","payload":{"id":"${sessionId}"}}\n`
  );
  return codexHome;
}

test("codex-run loudly records and prints stripped out-of-allowlist turn paths", () => {
  const { root, worktreeRoot } = gitRepoAtImplement();
  const sid = "allow-strip";
  const pf = path.join(root, "prompt.md");
  fs.writeFileSync(pf, "edit both files");
  assert.equal(jam(root, ["sprint", "fix-1", "--start"]).status, 0);

  const run = jam(root, ["codex-run", "--sprint", "fix-1", "--prompt-file", pf, "--out-dir", path.join(root, "cx")], {
    JAM_CODEX_BIN: FAKE,
    JAM_FAKE_SESSION_ID: sid,
    CODEX_HOME: codexHomeWithSession(sid),
    JAM_FAKE_EDIT: "allowed/keep.txt:allowed-change",
    JAM_FAKE_EDIT2: "other/drop.txt:scope-creep",
    JAM_WORKTREE_ROOT: worktreeRoot
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /scope-stripped 1 out-of-allowlist path\(s\) from turn fix-1#1: other\/drop\.txt/);
  assert.match(fs.readFileSync(path.join(root, "allowed", "keep.txt"), "utf8"), /allowed-change/);
  assert.equal(fs.readFileSync(path.join(root, "other", "drop.txt"), "utf8"), "base-other\n");

  const ledger = fs.readFileSync(path.join(root, "docs", "superpowers", "loop-runs", "r1", "ledger.jsonl"), "utf8");
  assert.match(ledger, /"type":"turn-scope-stripped"/);
  assert.match(ledger, /"dropped":\["other\/drop\.txt"\]/);
  assert.match(ledger, /"kept":\["allowed\/keep\.txt"\]/);

  const report = jam(root, ["report"]);
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /scope-stripped 1/);
});

test("codex-run prepends a scope-lock prompt preface listing allowed globs", () => {
  const { root, worktreeRoot } = gitRepoAtImplement({ allowedPaths: ["allowed/**", "tests/*.mjs"] });
  const sid = "allow-preface";
  const pf = path.join(root, "prompt.md");
  const promptOut = path.join(root, "received-prompt.txt");
  fs.writeFileSync(pf, "original prompt body\n");
  assert.equal(jam(root, ["sprint", "fix-1", "--start"]).status, 0);

  const run = jam(root, ["codex-run", "--sprint", "fix-1", "--prompt-file", pf, "--out-dir", path.join(root, "cx")], {
    JAM_CODEX_BIN: FAKE,
    JAM_FAKE_SESSION_ID: sid,
    CODEX_HOME: codexHomeWithSession(sid),
    JAM_FAKE_PROMPT_OUT: promptOut,
    JAM_WORKTREE_ROOT: worktreeRoot
  });
  assert.equal(run.status, 0, run.stderr);
  const received = fs.readFileSync(promptOut, "utf8");
  assert.match(received, /SCOPE LOCK/);
  assert.match(received, /may modify ONLY/);
  assert.match(received, /allowed\/\*\*/);
  assert.match(received, /tests\/\*\.mjs/);
  assert.match(received, /original prompt body/);
});

test("promote-sprint --allow records allowedPaths and status renders them", () => {
  const { root } = gitRepoAtImplement({ allowedPaths: ["allowed/**"] });
  const r = jam(root, ["promote-sprint", "fix-9", "--title", "discovered", "--reason", "found", "--allow", "plugins/jam/**,tests/*.mjs"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);

  const state = JSON.parse(fs.readFileSync(path.join(root, "docs", "superpowers", "loop-runs", "r1", "state.json"), "utf8"));
  assert.deepEqual(state.plan.sprints.find((s) => s.id === "fix-9").allowedPaths, ["plugins/jam/**", "tests/*.mjs"]);

  const status = jam(root, ["status"]);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /sprint fix-1: pending \[planned\].* allowed: allowed\/\*\*/);
  assert.match(status.stdout, /sprint fix-9: pending \[promoted\].* allowed: plugins\/jam\/\*\*, tests\/\*\.mjs/);
});
