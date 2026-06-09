import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAction } from "../plugins/jam/scripts/lib/reversibility.mjs";

test("irreversible types are flagged", () => {
  for (const type of ["delete-path","git-history-rewrite","git-force-push","db-drop","destructive-migration","infra-destroy","deploy","send-external","restart-rearchitect"]) {
    assert.equal(classifyAction({ type }).irreversible, true, type);
  }
});
test("destructive command patterns are flagged", () => {
  assert.equal(classifyAction({ type: "run", command: "rm -rf src/" }).irreversible, true);
  assert.equal(classifyAction({ type: "run", command: "git push --force origin main" }).irreversible, true);
  assert.equal(classifyAction({ type: "run", command: "psql -c 'DROP TABLE users'" }).irreversible, true);
  assert.equal(classifyAction({ type: "run", command: "terraform destroy -auto-approve" }).irreversible, true);
});
test("reversible actions are not flagged and carry no reasons", () => {
  const r = classifyAction({ type: "edit-file", target: "src/x.js" });
  assert.equal(r.irreversible, false);
  assert.deepEqual(r.reasons, []);
  assert.equal(classifyAction({ type: "run", command: "npm test" }).irreversible, false);
});
