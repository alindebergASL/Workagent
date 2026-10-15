/**
 * Which workspace a page's records live in travels in its address, so a
 * conversation, a piece of work or a hand-over opens in the workspace it
 * was reached from, not whichever one the server happens to list first.
 */
export const WORKSPACE_PARAM = "workspace";

/** Pages whose records are read inside one workspace. */
const SCOPED = /^\/(conversations|assignments)\//;

/**
 * The same address, naming the workspace its records live in. Only record
 * pages carry it; other addresses, and an unknown workspace, are unchanged.
 * Any other query and the fragment are kept.
 */
export function scopedHref(
  href: string,
  ws: string | null | undefined,
): string {
  if (!ws || !SCOPED.test(href)) return href;
  const hashAt = href.indexOf("#");
  const path = hashAt < 0 ? href : href.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : href.slice(hashAt);
  const queryAt = path.indexOf("?");
  const base = queryAt < 0 ? path : path.slice(0, queryAt);
  const params = new URLSearchParams(
    queryAt < 0 ? "" : path.slice(queryAt + 1),
  );
  params.set(WORKSPACE_PARAM, ws);
  return `${base}?${params.toString()}${hash}`;
}

export type ScopeStatus = "loading" | "ready" | "unavailable" | "unreadable";

/**
 * The workspace a record page reads from: the one its address names, when
 * this person can open it; otherwise not available (never silently another
 * workspace). An address that names none keeps its earlier meaning, the
 * default workspace. When the workspace list itself couldn't be read, that
 * is said as such, not as "not available".
 */
export function resolveScope<W extends { id: string }>({
  named,
  workspaces,
  fallback,
  loading,
  failed = false,
}: {
  named: string | null;
  workspaces: W[];
  fallback: W | null;
  loading: boolean;
  failed?: boolean;
}): { workspace: W | null; status: ScopeStatus } {
  if (loading) return { workspace: null, status: "loading" };
  if (failed) return { workspace: null, status: "unreadable" };
  const workspace = named
    ? (workspaces.find((w) => w.id === named) ?? null)
    : fallback;
  return { workspace, status: workspace ? "ready" : "unavailable" };
}
