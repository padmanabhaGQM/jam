// Pure assertion core for the real-codex smoke. No I/O, no codex — unit-tested.
// Given an `observation` assembled from a real codex-run, return { ok, failures }.
export function evaluateSmoke(observation) {
  const {
    status,
    eventTypes = [],
    sessionId,
    classification,
    lastMsg,
    expectToken,
    transcriptPath,
  } = observation || {};
  const failures = [];
  const seen = eventTypes.join(", ") || "none";

  if (status !== "completed") failures.push(`status not completed: ${status}`);
  if (!eventTypes.includes("thread.started")) failures.push(`missing event type thread.started (saw: ${seen})`);
  if (!eventTypes.includes("turn.completed")) failures.push(`missing event type turn.completed (saw: ${seen})`);
  if (!sessionId) failures.push("no session id extracted from thread.started");
  if (classification !== "completed") failures.push(`classifyTurn=${classification}, expected completed`);
  if (typeof lastMsg !== "string" || lastMsg.trim().length === 0) {
    failures.push("last-message (-o) file empty");
  } else if (!lastMsg.includes(expectToken)) {
    failures.push(`last-message missing expected token ${expectToken} (got: ${lastMsg.slice(0, 80)})`);
  }
  if (!transcriptPath) failures.push(`transcript not locatable under CODEX_HOME for session ${sessionId ?? "(none)"}`);

  return { ok: failures.length === 0, failures };
}
