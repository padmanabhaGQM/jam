import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const FAKE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));

test("fake-codex complete mode emits thread.started + turn.completed and writes -o", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jam-fake-"));
  const last = path.join(dir, "last.md");
  const r = spawnSync(FAKE, ["exec", "--json", "-o", last, "-"], { input: "hi", encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /"type":"thread.started"/);
  assert.match(r.stdout, /"type":"turn.completed"/);
  assert.match(fs.readFileSync(last, "utf8"), /FINAL:/);
});

test("fake-codex interrupt mode exits non-zero with no turn.completed", () => {
  const r = spawnSync(FAKE, ["exec", "--json", "-o", "/tmp/none", "-"], { input: "hi", encoding: "utf8", env: { ...process.env, JAM_FAKE_MODE: "interrupt" } });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /turn.completed/);
});
