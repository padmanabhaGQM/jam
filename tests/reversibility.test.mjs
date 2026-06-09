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
test("unrecognized or missing action types FAIL SAFE (treated as irreversible)", () => {
  const r = classifyAction({ type: "frobnicate-everything" });
  assert.equal(r.irreversible, true);
  assert.match(r.reasons.join(" "), /not a recognized reversible type|fail/i);
  assert.equal(classifyAction({}).irreversible, true);            // no type, no command
  assert.equal(classifyAction({ command: "echo hi" }).irreversible, true); // command but no type
});
test("known reversible types are allowed", () => {
  for (const type of ["edit-file","create-file","read-file","run","search","test","lint","build","format","rename","move-file","refactor"]) {
    assert.equal(classifyAction({ type }).irreversible, false, type);
  }
});
test("broadened destructive command patterns are flagged", () => {
  for (const cmd of [
    "rm -fr build/", "rm --recursive --force x", "git push origin +main",
    "truncate -s 0 db.sqlite", "psql -c 'TRUNCATE TABLE users'", "psql -c 'DELETE FROM users'",
    "dd if=/dev/zero of=/dev/sda", "find . -name '*.db' -delete", "git reset --hard HEAD~5",
    "git branch -D main", "shred -u secrets.txt", "mkfs.ext4 /dev/sdb",
  ]) {
    assert.equal(classifyAction({ type: "run", command: cmd }).irreversible, true, cmd);
  }
});
