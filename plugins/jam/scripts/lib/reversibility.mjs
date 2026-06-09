// Pure reversibility classifier. No I/O.
//
// FAIL-SAFE BY DESIGN: an action whose `type` is not a known-reversible type is
// treated as IRREVERSIBLE (requires human ratification). A taxonomy gap therefore
// OVER-blocks (a harmless action waits for a human) rather than silently allowing a
// catastrophe. `type` is a closed vocabulary; the command-pattern list below is
// best-effort and explicitly INCOMPLETE (shell commands are open-ended) — it is a
// backstop, not the primary guarantee. The primary guarantee is the type allowlist.
const IRREVERSIBLE_TYPES = new Set([
  "delete-path", "git-history-rewrite", "git-force-push", "db-drop",
  "destructive-migration", "infra-destroy", "deploy", "send-external", "restart-rearchitect",
]);
const REVERSIBLE_TYPES = new Set([
  "edit-file", "create-file", "read-file", "run", "search",
  "test", "lint", "build", "format", "rename", "move-file", "refactor",
]);
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-\S*[rf]\S*|--recursive|--force)/i,
  /\bgit\s+push\b.*(--force\b|\s-f\b|\s\+\w)/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+branch\s+-D\b/,
  /\bgit\s+checkout\s+--\s/,
  /\bDROP\s+(TABLE|DATABASE|SCHEMA|INDEX)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\btruncate\s+-s\b/,
  /\bterraform\s+destroy\b/,
  /\bkubectl\s+delete\b/,
  /\bgcloud\s+\S+\s+delete\b/,
  /\baws\s+\S+\s+rm\b/,
  /\bdd\b.*\bof=/,
  /\bshred\b/,
  /\bfind\b.*-delete\b/,
  /\bmkfs\b/,
];
export function classifyAction({ type, target, command } = {}) {
  const reasons = [];
  if (type && IRREVERSIBLE_TYPES.has(type)) {
    reasons.push(`type "${type}" is irreversible`);
  } else if (!type || !REVERSIBLE_TYPES.has(type)) {
    reasons.push(`action type ${type ? `"${type}"` : "(none)"} is not a recognized reversible type — failing safe (requires ratification)`);
  }
  if (command) {
    for (const re of DESTRUCTIVE_PATTERNS) {
      if (re.test(command)) reasons.push(`command matches destructive pattern ${re}`);
    }
  }
  return { irreversible: reasons.length > 0, reasons };
}
