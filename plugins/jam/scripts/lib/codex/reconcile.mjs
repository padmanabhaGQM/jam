import fs from "node:fs";

export function liveQuestionFromLast(lastMsg) {
  try { return fs.readFileSync(lastMsg, "utf8").trim(); } catch { return null; }
}

export function reconcile({ localPending, live }) {
  const norm = (s) => String(s ?? "").trim();
  if (norm(localPending) === norm(live)) return { match: true };
  return {
    match: false,
    recovery: {
      type: "question_state_mismatch",
      preserved: true,
      nextAction: "Answer the live facilitator question; local pending retained as stale evidence."
    }
  };
}
