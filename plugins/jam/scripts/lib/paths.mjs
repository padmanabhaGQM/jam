import fs from "node:fs";
import path from "node:path";

export function runsRoot(projectRoot) {
  return path.join(projectRoot, "docs", "superpowers", "loop-runs");
}
export function runDir(projectRoot, runId) {
  return path.join(runsRoot(projectRoot), runId);
}
export function activePointerPath(projectRoot) {
  return path.join(runsRoot(projectRoot), "ACTIVE");
}
export function readActiveRunId(projectRoot) {
  const p = activePointerPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  const id = fs.readFileSync(p, "utf8").trim();
  return id || null;
}
