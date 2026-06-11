import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function verAtLeast(v, major, minor) {
  const [a, b] = String(v).split(".").map(Number);
  return a > major || (a === major && b >= minor);
}

export function evaluateDoctor(p) {
  const checks = [];
  checks.push(verAtLeast(p.nodeVersion, 18, 18)
    ? { id: "node", level: "ok", text: `Node ${p.nodeVersion}` }
    : { id: "node", level: "fail", text: `Node ${p.nodeVersion}`, fix: "install Node 18.18+ (https://nodejs.org)" });
  checks.push(p.gitOk
    ? { id: "git", level: "ok", text: "git available" }
    : { id: "git", level: "fail", text: "git not found", fix: "install git" });
  checks.push(p.codexOk
    ? { id: "codex-bin", level: "ok", text: `codex binary: ${p.codexBin}` }
    : { id: "codex-bin", level: "fail", text: `codex binary not runnable (${p.codexBin})`, fix: "install the Codex CLI (npm i -g @openai/codex) or set JAM_CODEX_BIN to its path" });
  checks.push(p.codexAuthOk === true
    ? { id: "codex-auth", level: "ok", text: "codex authenticated" }
    : { id: "codex-auth", level: "warn", text: "codex auth unverified", fix: "run `codex login` (best-effort check; may be a false alarm on newer codex versions)" });
  checks.push(p.inGitRepo && p.hasHead
    ? { id: "git-repo", level: "ok", text: "project is a git repo with an initial commit" }
    : { id: "git-repo", level: "warn", text: "project is not a git repo with a commit", fix: "jam's turn isolation needs git: `git init && git add -A && git commit -m init`" });
  checks.push(p.pluginVersion === p.packageVersion
    ? { id: "versions", level: "ok", text: `version ${p.pluginVersion}` }
    : { id: "versions", level: "warn", text: `version mismatch (plugin ${p.pluginVersion} vs package ${p.packageVersion})`, fix: "reinstall/update the jam plugin" });
  return { checks, ok: checks.every((c) => c.level !== "fail") };
}

export function gatherProbes(cwd) {
  const sh = (bin, args) => { const r = spawnSync(bin, args, { encoding: "utf8" }); return (r.status ?? -1) === 0; };
  const codexBin = process.env.JAM_CODEX_BIN || "codex";
  const here = path.dirname(fileURLToPath(import.meta.url));            // .../plugins/jam/scripts/lib
  const readVer = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")).version ?? null; } catch { return null; } };
  return {
    nodeVersion: process.versions.node,
    gitOk: sh("git", ["--version"]),
    codexBin,
    codexOk: sh(codexBin, ["--version"]),
    codexAuthOk: sh(codexBin, ["login", "status"]),
    inGitRepo: spawnSync("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }).stdout?.trim() === "true",
    hasHead: sh("git", ["-C", cwd, "rev-parse", "--verify", "-q", "HEAD"]),
    pluginVersion: readVer(path.join(here, "..", "..", ".claude-plugin", "plugin.json")),
    packageVersion: readVer(path.join(here, "..", "..", "..", "..", "package.json")),
  };
}

export function renderDoctor(r) {
  const sym = { ok: "✓", warn: "⚠", fail: "✗" };
  return r.checks.map((c) => `  ${sym[c.level]} ${c.text}${c.fix ? `\n      fix: ${c.fix}` : ""}`).join("\n")
    + `\n${r.ok ? "doctor: OK" : "doctor: problems found"}\n`;
}
