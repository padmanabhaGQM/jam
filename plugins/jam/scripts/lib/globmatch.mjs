// Zero-dep, repo-relative, /-separated path glob matching. Supported syntax (documented, minimal):
//   exact            "lib/foo.mjs"
//   dir prefix       "lib/"  (or "lib/**")  -> everything under lib/
//   *                within a single segment (no "/")
//   **               across segments (matches zero or more, including across "/")
function globToRegExp(glob) {
  if (glob.endsWith("/")) glob = glob + "**";                  // "lib/" -> "lib/**"
  // Tokenize, escaping regex metachars except our wildcards. Handle "**" before "*".
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === "*" && glob[i + 1] === "*") {
      // ** -> match any chars incl. "/"; swallow an optional following "/" so "a/**/d" matches "a/d"
      i++;
      if (glob[i + 1] === "/") { re += "(?:.*/)?"; i++; } else { re += ".*"; }
    } else if (glob[i] === "*") {
      re += "[^/]*";                                            // single segment
    } else {
      re += glob[i].replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(re + "$");
}

export function matchesAny(p, globs) {
  if (!Array.isArray(globs) || globs.length === 0) return false;
  return globs.some((g) => globToRegExp(String(g)).test(p));
}

export function partitionTouched(names, allowedPaths) {
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    return { kept: [...names], dropped: [] };                  // no allowlist -> keep all
  }
  const kept = [], dropped = [];
  for (const n of names) (matchesAny(n, allowedPaths) ? kept : dropped).push(n);
  return { kept, dropped };
}
