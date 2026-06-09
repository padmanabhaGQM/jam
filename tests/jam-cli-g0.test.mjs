import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-clig0-")); }
function jam(cwd, args) { return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" }); }
function start(root) { jam(root, ["start", "g0 test", "--run-id", "r1"]); }

test("propose-action hard-blocks irreversible; ratify --confirm opens it; reversible flows", () => {
  const root = tmp(); start(root);
  const p = jam(root, ["propose-action", "del-1", "--type", "delete-path", "--target", "src/"]);
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /HARD-BLOCKED/);
  assert.match(jam(root, ["status"]).stdout, /action del-1: delete-path \[HARD-BLOCK\] proposed/);
  assert.notEqual(jam(root, ["ratify", "del-1", "--confirm", "wrong"]).status, 0);
  assert.equal(jam(root, ["ratify", "del-1", "--confirm", "del-1"]).status, 0);
  assert.match(jam(root, ["status"]).stdout, /action del-1: delete-path \[HARD-BLOCK\] ratified/);
  assert.match(jam(root, ["propose-action", "edit-1", "--type", "edit-file", "--target", "x.js"]).stdout, /reversible|ok/i);
});

test("RED-TEAM: /jam:approve cannot open a ratified-bound action gate (only ratify can)", () => {
  const root = tmp(); start(root);
  jam(root, ["propose-action", "del-9", "--type", "delete-path"]);
  const ap = jam(root, ["approve", "action-del-9"]);
  assert.notEqual(ap.status, 0);                                   // approve must NOT satisfy a ratified gate
  assert.match(jam(root, ["status"]).stdout, /action del-9: .*proposed/);  // still undecided
});

test("ratify --deny refuses the action", () => {
  const root = tmp(); start(root);
  jam(root, ["propose-action", "drop-1", "--type", "db-drop"]);
  assert.equal(jam(root, ["ratify", "drop-1", "--deny"]).status, 0);
  assert.match(jam(root, ["status"]).stdout, /action drop-1: .*denied/);
});

test("jam cancel requires a typed --confirm matching the run id", () => {
  const root = tmp(); start(root);
  assert.notEqual(jam(root, ["cancel"]).status, 0);
  assert.match(jam(root, ["cancel"]).stderr, /irreversible.*--confirm/);
  assert.equal(jam(root, ["cancel", "--confirm", "r1"]).status, 0);
});
