import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { readActiveRunId } from "../plugins/jam/scripts/lib/paths.mjs";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jam-cli-"));
}
function jam(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

test("start creates a run, sets ACTIVE pointer, prints the run id", () => {
  const root = tmpProject();
  const r = jam(root, ["start", "build a thing", "--run-id", "r1"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /r1/);
  assert.equal(readActiveRunId(root), "r1");
});

test("status reports phase and the ALIGN gate", () => {
  const root = tmpProject();
  jam(root, ["start", "x", "--run-id", "r1"]);
  const r = jam(root, ["status"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ALIGN/);
  assert.match(r.stdout, /pending/);
});

test("status with no active run exits non-zero with a clear message", () => {
  const root = tmpProject();
  const r = jam(root, ["status"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /no active jam run/i);
});

test("unknown subcommand exits non-zero", () => {
  const root = tmpProject();
  const r = jam(root, ["frobnicate"]);
  assert.notEqual(r.status, 0);
});
