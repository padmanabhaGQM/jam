import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function runVerification(command, cwd) {
  if (!command) throw new Error("runVerification: command required");
  const result = spawnSync(command, { cwd, shell: true, encoding: "utf8" });
  return {
    command,
    exitCode: result.status === null ? -1 : result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

export function captureEvidence(dir, sprintId, evidence) {
  const evDir = path.join(dir, "evidence");
  fs.mkdirSync(evDir, { recursive: true });
  const p = path.join(evDir, `${sprintId}.json`);
  fs.writeFileSync(p, JSON.stringify(evidence, null, 2));
  return p;
}
