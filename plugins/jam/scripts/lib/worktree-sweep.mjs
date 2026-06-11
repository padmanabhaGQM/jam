export function shouldSweepAbandonedWorktree(w, { pidAlive, hasTurnCompleted } = {}) {
  if (w.pid && typeof pidAlive === "function" && pidAlive(w.pid)) return false;
  const done = !!(w.eventLog && typeof hasTurnCompleted === "function" && hasTurnCompleted(w.eventLog));
  return done || !w.pid;
}
