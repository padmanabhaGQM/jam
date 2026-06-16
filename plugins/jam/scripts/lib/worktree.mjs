import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { partitionTouched } from "./globmatch.mjs";

function git(repoRoot, args, opts = {}) {
  const r = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", ...opts });
  return { code: r.status === null ? -1 : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function slug(token) { return token.replace(/[^a-z0-9]+/gi, "-"); }
function physicalPathForPossiblyMissing(p) {
  let cur = path.resolve(p);
  const missing = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    missing.unshift(path.basename(cur));
    cur = parent;
  }
  const realBase = fs.existsSync(cur) ? fs.realpathSync.native(cur) : cur;
  return path.join(realBase, ...missing);
}

export function isGitRepo(root) {
  return git(root, ["rev-parse", "--is-inside-work-tree"]).stdout.trim() === "true";
}

export function parseLsTreeRecords(out) {
  const records = [];
  for (const entry of out.split("\0")) {
    if (!entry) continue;
    const tab = entry.indexOf("\t");
    if (tab === -1) continue;
    const header = entry.slice(0, tab);
    const path = entry.slice(tab + 1);
    const [mode, type, sha, size] = header.trim().split(/\s+/);
    if (!mode || !type || !sha) continue;
    records.push({ mode, type, sha, size, path });
  }
  return records;
}

export function largeTrackedBlobs(repoRoot, ref, maxBytes) {
  const out = git(repoRoot, ["ls-tree", "-r", "-l", "-z", ref]).stdout;
  const big = [];
  for (const entry of parseLsTreeRecords(out)) {
    if (entry.size && Number(entry.size) > maxBytes) big.push(entry.path);
  }
  return big;
}

function trackedSymlinks(repoRoot, ref) {
  const out = git(repoRoot, ["ls-tree", "-r", "-z", ref]).stdout;
  const links = [];
  for (const entry of parseLsTreeRecords(out)) {
    if (entry.mode === "120000") links.push(entry.path);
  }
  return links;
}

function assertSparseExcludesAreLineSafe(paths) {
  if (paths.some((p) => p.includes("\n") || p.includes("\0"))) {
    throw new Error("openTurnWorktree: cannot safely exclude path with newline — refusing to open an isolated worktree");
  }
}

// Snapshot HEAD + tracked changes + untracked-not-ignored into a dangling commit (no main-tree/index/branch
// mutation), then create a linked worktree at that commit with large tracked blobs sparse-excluded.
export function openTurnWorktree({ repoRoot, sprintId, token, runId, maxBlobBytes }) {
  const top = git(repoRoot, ["rev-parse", "--show-toplevel"]).stdout.trim();
  if (top) repoRoot = top;                                       // normalize: --cwd may be a subdir
  const max = (maxBlobBytes ?? Number(process.env.JAM_WORKTREE_MAX_BLOB)) || 5 * 1024 * 1024;  // () — no mixed ??/||
  const tmpIndex = path.join(os.tmpdir(), `jam-idx-${slug(token)}-${process.pid}`);
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  const scratch = path.resolve(process.env.JAM_WORKTREE_ROOT || path.join(os.tmpdir(), "jam-worktrees"));
  const realRepo = fs.realpathSync.native(repoRoot);
  const physicalScratch = physicalPathForPossiblyMissing(scratch);
  if (physicalScratch === realRepo || physicalScratch.startsWith(realRepo + path.sep)) throw new Error("openTurnWorktree: JAM_WORKTREE_ROOT must be OUTSIDE the repo (structural isolation)");
  try {
    // Exclude .jam/ BEFORE the baseline `add -A`, so prior turns' scratch/worktrees are never captured.
    // Keep jam's own internals out of the baseline AND out of any future reconcile (a Codex turn that runs
    // `jam` inside its worktree must never have loop-runs/ACTIVE/state/ledger reconciled into the controller).
    const internals = [".jam/", "docs/superpowers/loop-runs/"];
    const excl = git(repoRoot, ["rev-parse", "--git-path", "info/exclude"]).stdout.trim();   // correct even when .git is a file (linked worktree)
    const exclAbs = path.isAbsolute(excl) ? excl : path.join(repoRoot, excl);
    try { const cur = fs.readFileSync(exclAbs, "utf8"); const add = internals.filter((p) => !cur.includes(p)); if (add.length) fs.appendFileSync(exclAbs, "\n" + add.join("\n") + "\n"); }
    catch { try { fs.mkdirSync(path.dirname(exclAbs), { recursive: true }); fs.writeFileSync(exclAbs, internals.join("\n") + "\n"); } catch {} }
    if (git(repoRoot, ["rev-parse", "--verify", "-q", "HEAD"]).code !== 0) throw new Error("openTurnWorktree: repo has no commits (unborn HEAD) — make an initial commit before running jam");
    if (git(repoRoot, ["read-tree", "HEAD"], { env }).code !== 0) throw new Error("openTurnWorktree: read-tree HEAD failed");
    if (git(repoRoot, ["add", "-A"], { env }).code !== 0) throw new Error("openTurnWorktree: baseline add failed");   // respects .gitignore (incl. the just-excluded internals)
    const tree = git(repoRoot, ["write-tree"], { env }).stdout.trim();
    if (!tree) throw new Error("openTurnWorktree: write-tree failed");
    const baselineRef = git(repoRoot, ["commit-tree", tree, "-p", "HEAD", "-m", `jam-wip ${token}`]).stdout.trim();
    // Worktree lives OUTSIDE the repo (structural isolation: the main tree is not reachable via `../` from the
    // turn cwd, so safety does not depend on the Codex sandbox). git shares .git objects via the gitdir link,
    // so large binaries are not duplicated even across filesystems. Override the scratch root with JAM_WORKTREE_ROOT.
    const namespace = runId ? slug(runId) : slug(path.basename(repoRoot));
    const wt = path.join(scratch, `${namespace}-${slug(token)}`);  // runId-namespaced: tokens like fix-1#1 repeat across runs
    fs.mkdirSync(path.dirname(wt), { recursive: true });
    if (!baselineRef) throw new Error("openTurnWorktree: failed to create baseline commit");
    const big = largeTrackedBlobs(repoRoot, baselineRef, max);
    // Symlinks are excluded fail-safe: a checked-out repo symlink could physically point back into the controller tree.
    const sparseExcludes = [...big, ...trackedSymlinks(repoRoot, baselineRef)];
    assertSparseExcludesAreLineSafe(sparseExcludes);
    const add = git(repoRoot, ["worktree", "add", "--no-checkout", wt, baselineRef]);
    if (add.code !== 0) throw new Error(`openTurnWorktree: git worktree add failed: ${add.stderr}`);
    try {
      if (git(wt, ["sparse-checkout", "init", "--no-cone"]).code !== 0) throw new Error("openTurnWorktree: sparse-checkout init failed");
      if (git(wt, ["sparse-checkout", "set", "/*", ...sparseExcludes.map((p) => `!${p}`)]).code !== 0) throw new Error("openTurnWorktree: sparse-checkout set failed");
      const co = git(wt, ["checkout"]);
      if (co.code !== 0) throw new Error(`openTurnWorktree: worktree checkout failed: ${co.stderr}`);
      const headAtOpen = git(repoRoot, ["rev-parse", "HEAD"]).stdout.trim();   // detect a deliberate shared-ref move at reconcile
      return { worktreePath: wt, baselineRef, repoRoot, headAtOpen };          // repoRoot = normalized git top-level
    } catch (e) {
      git(repoRoot, ["worktree", "remove", "--force", wt]);
      git(repoRoot, ["worktree", "prune"]);
      throw e;
    }
  } finally {
    try { fs.rmSync(tmpIndex, { force: true }); } catch {}
  }
}

// Apply the turn's net change (baselineRef -> worktree) to the main tree. Refuses on drift.
// Drift gate is path-level (not just `apply --check`): every path the turn touched must, in the MAIN
// working tree, still equal baselineRef — so a concurrent human edit to a touched file is REFUSED, not
// silently merged. `--binary` so binary changes reconcile faithfully.
// jam internals are NEVER reconciled (a turn that ran `jam` in its worktree must not push loop-runs/ACTIVE,
// state, ledger, or .jam scratch back into the controller tree).
const RECONCILE_EXCLUDES = ["--", ".", ":(exclude).jam/**", ":(exclude)docs/superpowers/loop-runs/**"];
export function reconcileTurnWorktree({ repoRoot, worktreePath, baselineRef, headAtOpen, allowedPaths }) {
  if (!worktreePath || !baselineRef || !fs.existsSync(worktreePath)) return { applied: false, error: "missing worktree or baseline" };
  // A linked worktree shares the controller's refs; an ordinary commit only moves the worktree's detached HEAD,
  // but a turn that deliberately ran `git update-ref`/`git push .` could have moved the controller branch.
  // Detect it: refuse to reconcile onto a controller whose HEAD moved during the turn.
  if (headAtOpen && git(repoRoot, ["rev-parse", "HEAD"]).stdout.trim() !== headAtOpen) return { applied: false, headMoved: true };
  if (git(worktreePath, ["add", "-A"]).code !== 0) return { applied: false, error: "git add failed in worktree" };
  // --no-renames when an allowlist is set, so a rename is reported as its delete+add halves (each then
  // partitioned independently); without an allowlist, keep today's diff exactly.
  const ndArgs = (Array.isArray(allowedPaths) && allowedPaths.length)
    ? ["diff", "--cached", "--name-only", "-z", "--no-renames", baselineRef, ...RECONCILE_EXCLUDES]
    : ["diff", "--cached", "--name-only", "-z", baselineRef, ...RECONCILE_EXCLUDES];
  const nd = git(worktreePath, ndArgs);
  if (nd.code !== 0) return { applied: false, error: "git diff (names) failed" };
  const allNames = nd.stdout.split("\0").filter(Boolean);
  if (allNames.some((p) => p.includes("\n"))) return { applied: false, error: "touched path contains a newline — refusing to reconcile" };
  const { kept: names, dropped } = partitionTouched(allNames, allowedPaths);   // strip out-of-scope
  if (names.length === 0) return { applied: false, empty: true, dropped, kept: [] };  // nothing in-scope (or genuine no-op)
  // path-level drift by CONTENT HASH (not `git diff baselineRef`, which falsely reports a baseline-captured
  // UNTRACKED file as deleted): each touched path's current main-tree content must equal its baseline blob.
  for (const p of names) {
    const bp = git(repoRoot, ["rev-parse", `${baselineRef}:${p}`]);
    const baseId = bp.code === 0 ? bp.stdout.trim() : null;          // null = path absent in baseline (turn adds it)
    const abs = path.join(repoRoot, p);
    const mainId = fs.existsSync(abs) ? git(repoRoot, ["hash-object", abs]).stdout.trim() : null;
    if (baseId !== mainId) return { applied: false, drift: true, path: p, dropped, kept: names };
  }
  // patch the KEPT paths only (explicit pathspec instead of "." so dropped changes never land)
  // Build the apply patch. With NO allowlist, use the original diff unchanged (native rename handling,
  // byte-identical behavior). WITH an allowlist, we patch explicit kept paths — so use --no-renames on
  // BOTH the name diff (above) and here, turning a rename into a delete+add PAIR (both appear in `names`,
  // both get patched); and use :(literal) so a glob-metachar filename can't re-include a dropped sibling.
  const stripping = Array.isArray(allowedPaths) && allowedPaths.length > 0;
  const pd = stripping
    ? git(worktreePath, ["diff", "--cached", "--binary", "--no-renames", baselineRef, "--", ...names.map((n) => `:(literal)${n}`)])
    : git(worktreePath, ["diff", "--cached", "--binary", baselineRef, ...RECONCILE_EXCLUDES]);
  if (pd.code !== 0) return { applied: false, error: "git diff (patch) failed" };
  const patch = pd.stdout;
  const patchFile = path.join(os.tmpdir(), `jam-patch-${process.pid}-${Date.now()}.diff`);
  try {
    fs.writeFileSync(patchFile, patch);
    const check = spawnSync("git", ["-C", repoRoot, "apply", "--check", patchFile], { encoding: "utf8" });
    if ((check.status ?? -1) !== 0) return { applied: false, drift: true, stderr: check.stderr ?? "", dropped, kept: names };
    const apply = spawnSync("git", ["-C", repoRoot, "apply", patchFile], { encoding: "utf8" });
    if ((apply.status ?? -1) !== 0) return { applied: false, error: apply.stderr ?? "", dropped, kept: names };
  } finally {
    try { fs.rmSync(patchFile, { force: true }); } catch {}
  }
  return { applied: true, kept: names, dropped };
}

// Only call on a COMPLETED turn. Never rm -rf — a never-killed turn may still hold the dir; deleting it
// could disrupt the live process. On failure, leave the dir and prune; gcWorktrees sweeps it once free.
export function discardTurnWorktree({ repoRoot, worktreePath }) {
  const r = git(repoRoot, ["worktree", "remove", "--force", worktreePath]);
  if (r.code !== 0) { git(repoRoot, ["worktree", "prune"]); return { removed: false }; }
  return { removed: true };
}

export function gcWorktrees({ repoRoot }) { git(repoRoot, ["worktree", "prune"]); }
