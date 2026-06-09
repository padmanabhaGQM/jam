import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSprintPrompt } from "../plugins/jam/scripts/lib/prompting.mjs";

test("buildSprintPrompt names TDD, the sprint, acceptance, and active directives", () => {
  const p = buildSprintPrompt({
    sprint: { id: "fix-1", title: "wire the gate", acceptanceCriteria: "no hard failures" },
    goal: "reviewer mean >= 4.1",
    directives: [{ id: "d1", text: "no hardcoding", status: "active" }, { id: "d2", text: "stale", status: "satisfied" }]
  });
  assert.match(p, /test-driven-development/);
  assert.match(p, /wire the gate/);
  assert.match(p, /no hard failures/);
  assert.match(p, /reviewer mean >= 4\.1/);
  assert.match(p, /d1/);
  assert.doesNotMatch(p, /d2/);
  assert.match(p, /exact evidence/i);
  assert.match(p, /do not exceed/i);
});
