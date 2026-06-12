import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HOOK = fileURLToPath(new URL("../plugins/jam/scripts/session-start-hook.mjs", import.meta.url));
const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-ssh-")); }
function runHook(cwd) { return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd }), encoding: "utf8" }); }
function jam(cwd, args) { return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" }); }
function writeJSON(p, o) { fs.writeFileSync(p, JSON.stringify(o)); return p; }

test("session-start hook: active run → prints status + next action; exit 0", () => {
  const root = tmp();
  jam(root, ["diagnose", "fix", "--goal", writeJSON(path.join(root, "g.txt"), { x: 1 }), "--run-id", "r1"]);
  const r = runHook(root);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /jam run r1/i);
  assert.match(r.stdout, /next:/);
});

test("session-start hook: non-jam project → silent exit 0", () => {
  const r = runHook(tmp());
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});

test("session-start hook: corrupt state → silent exit 0 (never breaks session start)", () => {
  const root = tmp();
  const rd = path.join(root, "docs", "superpowers", "loop-runs");
  fs.mkdirSync(path.join(rd, "r1"), { recursive: true });
  fs.writeFileSync(path.join(rd, "ACTIVE"), "r1");
  fs.writeFileSync(path.join(rd, "r1", "state.json"), "{not json");
  const r = runHook(root);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});
