// Scripts that call the same-origin proxy directly must name the session
// scope a page would be bound to (Batch 2, A14): the proxy refuses any other
// request with 401 before forwarding it. The scope is read from the proxy's
// own session probe, exactly as a page binds; the bearer never leaves it.

const SCOPE = /^[a-f0-9]{64}$/;

/** The browser scope the proxy proves for this origin's backend session. */
export async function sessionScope(origin) {
  const r = await fetch(`${origin}/api/domain/v1/session`, {
    headers: { "X-Workagent-Client": "local-ui" },
    cache: "no-store",
  });
  const body = r.ok ? await r.json() : null;
  if (!r.ok || !SCOPE.test(body?.scope_id ?? ""))
    throw new Error(
      `session scope unavailable: HTTP ${r.status} from ${origin}/api/domain/v1/session`,
    );
  return body.scope_id;
}

/** The given headers plus the scope header the proxy requires. */
export async function scopedHeaders(origin, headers = {}) {
  return { ...headers, "X-Workagent-Scope": await sessionScope(origin) };
}
