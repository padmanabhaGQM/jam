import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGroundingPrompt, buildAdversarialPrompt } from "../plugins/jam/scripts/lib/prompting.mjs";

test("grounding prompt names systematic-debugging, the goal, and active directives", () => {
  const p = buildGroundingPrompt({
    goal: "reviewer mean >= 4.1",
    repoFacts: "validators in src/",
    directives: [{ id: "d1", text: "no hardcoding", status: "active" }, { id: "d2", text: "stale", status: "satisfied" }]
  });
  assert.match(p, /systematic-debugging/);
  assert.match(p, /reviewer mean >= 4\.1/);
  assert.match(p, /d1/);
  assert.doesNotMatch(p, /d2/);
  assert.match(p, /root cause/i);
  assert.match(p, /do not propose local/i);
});

test("adversarial prompt names verification-before-completion and says REFUTE", () => {
  const p = buildAdversarialPrompt({ diagnosis: "RC: no gen-time gate", goal: "g" });
  assert.match(p, /verification-before-completion/);
  assert.match(p, /refute/i);
  assert.match(p, /RC: no gen-time gate/);
  assert.match(p, /unresolvedBlockers/);
});
