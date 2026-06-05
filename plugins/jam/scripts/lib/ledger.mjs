import fs from "node:fs";
import path from "node:path";

export function ledgerPath(dir) {
  return path.join(dir, "ledger.jsonl");
}

export function appendLedger(dir, entry) {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(ledgerPath(dir), JSON.stringify(entry) + "\n");
  return entry;
}

export function readLedger(dir) {
  const p = ledgerPath(dir);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}
