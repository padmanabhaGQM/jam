import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";
import { readState, validateState } from "../plugins/jam/scripts/lib/state.mjs";
import { validateSprintGraph } from "../plugins/jam/scripts/lib/plan.mjs";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-graph-")); }
const S = (id, needs = []) => ({ id, title: id, needs });

test("validateSprintGraph: valid DAG (incl. diamond) has no errors", () => {
  assert.deepEqual(validateSprintGraph([S("a"), S("b", ["a"]), S("c", ["a"]), S("d", ["b", "c"])]), []);
});

test("validateSprintGraph: self-dependency, dangling need, and cycles are caught", () => {
  assert.match(validateSprintGraph([S("a", ["a"])]).join(" | "), /cannot depend on itself/);
  assert.match(validateSprintGraph([S("a", ["zzz"])]).join(" | "), /unknown sprint zzz/);
  assert.match(validateSprintGraph([S("a", ["b"]), S("b", ["a"])]).join(" | "), /cycle/);
  assert.match(validateSprintGraph([S("a", ["c"]), S("b", ["a"]), S("c", ["b"])]).join(" | "), /cycle/);
});

test("validateState value-checks needs (array of strings), lenient on absence", () => {
  const dir = createRun({ projectRoot: tmp(), runId: "r1", mode: "repair", now: "t" });
  const s = readState(dir);
  s.plan = { verifyCmd: "true", sprints: [{ id: "a", title: "t", status: "pending", provenance: "planned", needs: ["x"] }] };
  assert.equal(validateState(s).length, 0);
  s.plan.sprints[0].needs = "nope";
  assert.ok(validateState(s).some((e) => /needs/.test(e)));
  delete s.plan.sprints[0].needs;
  assert.equal(validateState(s).length, 0);
});
