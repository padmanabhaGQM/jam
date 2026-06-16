import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesAny, partitionTouched } from "../plugins/jam/scripts/lib/globmatch.mjs";

test("exact path matches only itself", () => {
  assert.equal(matchesAny("lib/foo.mjs", ["lib/foo.mjs"]), true);
  assert.equal(matchesAny("lib/bar.mjs", ["lib/foo.mjs"]), false);
});
test("directory prefix matches everything under it", () => {
  assert.equal(matchesAny("lib/sub/x.mjs", ["lib/"]), true);
  assert.equal(matchesAny("lib/sub/x.mjs", ["lib/**"]), true);
  assert.equal(matchesAny("libs/x.mjs", ["lib/"]), false);   // prefix must be a path boundary
});
test("* matches within one segment, not across /", () => {
  assert.equal(matchesAny("src/a.ts", ["src/*.ts"]), true);
  assert.equal(matchesAny("src/deep/a.ts", ["src/*.ts"]), false);
  assert.equal(matchesAny("src/deep/a.ts", ["src/**/*.ts"]), true);
});
test("** matches across segments", () => {
  assert.equal(matchesAny("a/b/c/d.ts", ["a/**/d.ts"]), true);
  assert.equal(matchesAny("a/d.ts", ["a/**/d.ts"]), true);   // ** matches zero segments too
});
test("dotfiles and nested are handled", () => {
  assert.equal(matchesAny(".github/ci.yml", [".github/**"]), true);
  assert.equal(matchesAny("x", []), false);                  // empty globs match nothing
});
test("partitionTouched splits kept vs dropped, preserving order", () => {
  const r = partitionTouched(["lib/foo.mjs", "scene0.tsx", "lib/bar.mjs"], ["lib/**"]);
  assert.deepEqual(r.kept, ["lib/foo.mjs", "lib/bar.mjs"]);
  assert.deepEqual(r.dropped, ["scene0.tsx"]);
});
test("partitionTouched with no allowlist keeps everything", () => {
  const r = partitionTouched(["a", "b"], undefined);
  assert.deepEqual(r.kept, ["a", "b"]);
  assert.deepEqual(r.dropped, []);
});
