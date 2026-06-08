export function buildGroundingPrompt({ goal, repoFacts, directives }) {
  const active = (directives ?? []).filter((d) => d.status === "active");
  return [
    "Use your superpowers:systematic-debugging skill. Find the ROOT CAUSE before proposing any fix.",
    `Acceptance goal:\n${goal ?? "(none provided)"}`,
    `Repo facts:\n${repoFacts ?? "(none)"}`,
    active.length ? `Active steering directives (must honor):\n${active.map((d) => `- [${d.id}] ${d.text}`).join("\n")}` : "",
    "Deliver: a global state-map; the root cause(s) of the local-pass/global-break gap; a prioritized fix-plan tagged global-structural vs local-patch, citing files/lines and validator evidence. Do NOT propose local patches."
  ].filter(Boolean).join("\n\n");
}

export function buildAdversarialPrompt({ diagnosis, goal }) {
  return [
    "Use your superpowers:verification-before-completion skill. REFUTE the diagnosis below against the source — do not nitpick.",
    `Acceptance goal:\n${goal ?? "(none)"}`,
    `Diagnosis to refute:\n${diagnosis ?? "(none)"}`,
    "Return a verdict: are the root causes correct and GLOBAL (not local patches dressed as global fixes)? What failure mode is missed? Set unresolvedBlockers > 0 if the diagnosis is not safe to plan from."
  ].join("\n\n");
}
