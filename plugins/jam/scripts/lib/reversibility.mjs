// Pure reversibility classifier. No I/O. The taxonomy is explicit and meant to grow.
const IRREVERSIBLE_TYPES = new Set([
  "delete-path", "git-history-rewrite", "git-force-push", "db-drop",
  "destructive-migration", "infra-destroy", "deploy", "send-external", "restart-rearchitect",
]);
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf?\b/, /git\s+push\s+.*(--force|-f)\b/, /git\s+reset\s+--hard\b/,
  /\bDROP\s+(TABLE|DATABASE)\b/i, /\bterraform\s+destroy\b/, /\bkubectl\s+delete\b/, /\bgcloud\s+\S+\s+delete\b/,
];
export function classifyAction({ type, target, command } = {}) {
  const reasons = [];
  if (IRREVERSIBLE_TYPES.has(type)) reasons.push(`type "${type}" is irreversible`);
  if (command) {
    for (const re of DESTRUCTIVE_PATTERNS) {
      if (re.test(command)) reasons.push(`command matches destructive pattern ${re}`);
    }
  }
  return { irreversible: reasons.length > 0, reasons };
}
