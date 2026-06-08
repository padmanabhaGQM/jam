import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
const FAKE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jam-ccli-"));
}

function jam(cwd, args, extraEnv) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, JAM_CODEX_BIN: FAKE, ...extraEnv }
  });
}

test("codex-run completes via fake and prints status + session + message", () => {
  const root = tmp();
  const pf = path.join(root, "p.md");
  fs.writeFileSync(pf, "diagnose this");
  const out = path.join(root, "out");
  const r = jam(root, ["codex-run", "--prompt-file", pf, "--out-dir", out, "--timeout", "5000"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /status: completed/);
  assert.match(r.stdout, /session: fake-session-1/);
  assert.match(r.stdout, /FINAL:/);
});

test("codex-run on a hang times out, surfaces resume hint, exits 0 (no kill)", () => {
  const root = tmp();
  const pf = path.join(root, "p.md");
  fs.writeFileSync(pf, "x");
  const out = path.join(root, "out");
  const r = jam(root, ["codex-run", "--prompt-file", pf, "--out-dir", out, "--timeout", "300"], {
    JAM_FAKE_MODE: "hang"
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /status: timed_out/);
  assert.match(r.stdout, /NOT killed/i);
  assert.match(r.stdout, /jam codex-resume fake-session-1/);
});

test("codex-status classifies an event log", () => {
  const root = tmp();
  const log = path.join(root, "e.jsonl");
  fs.writeFileSync(
    log,
    JSON.stringify({ type: "thread.started", thread_id: "s9" }) +
      "\n" +
      JSON.stringify({ type: "turn.completed" }) +
      "\n"
  );
  const r = jam(root, ["codex-status", "--event-log", log]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /completed/);
  assert.match(r.stdout, /s9/);
});

test("existing sync subcommand still works under async main (status with no run)", () => {
  const root = tmp();
  const r = jam(root, ["status"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /no active jam run/i);
});
