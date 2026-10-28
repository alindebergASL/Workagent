/**
 * The authenticated scope this page is bound to (A14).
 *
 * Everything this device keeps (drafts, staged document bytes, pending
 * commands, journals) and every request is bound to the scope the proxy
 * proves from the private credential and backend endpoint, never to a
 * build-time principal string. Until the session is proven nothing is read,
 * written or sent. A page binds to at most one scope: once the scope changes
 * or can no longer be confirmed, the page is fenced for good (only a reload
 * can bind again), so a continuation started under one identity can never
 * read, write or send under another. Records kept under any other scope,
 * including older unscoped ones, are left exactly as they are and never read.
 *
 * The scope is a fence, not authorization: the server still decides access.
 */
import { ApiError } from "@/lib/contract/errors";

export const SCOPE_HEADER = "X-Workagent-Scope";
const SESSION_URL = "/api/domain/v1/session";
const PREFIX = "workagent:scope:v1:";
const SCOPE = /^[a-f0-9]{64}$/;
/** Pure demo mode only; never a fallback for a real session. */
export const MOCK_IDENTITY = {
  principal_id: "alex",
  scope_id: "0".repeat(64),
} as const;

export type ScopeState =
  | { status: "checking" }
  | { status: "ready"; principal_id: string; scope_id: string }
  /** Never bound: the session couldn't be confirmed. */
  | { status: "unavailable" }
  /** Was bound; access changed or can no longer be confirmed. Terminal. */
  | { status: "changed" };

let state: ScopeState = { status: "checking" };
let seq = 0;
const listeners = new Set<() => void>();

function set(next: ScopeState) {
  if (state.status === "changed") return;
  state = next;
  for (const l of listeners) l();
}

export const scopeState = (): ScopeState => state;
export function subscribeScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
/** The bound scope, or null while unknown or fenced. */
export const boundScope = (): string | null =>
  state.status === "ready" ? state.scope_id : null;

/** Fences this page: nothing more is read, written or sent here. */
export function fenceScope() {
  if (state.status === "ready") set({ status: "changed" });
  else if (state.status === "checking") set({ status: "unavailable" });
}

/**
 * Asks the proxy which scope is authenticated now. Only the newest probe
 * applies; a different scope (or a refusal) after binding fences the page.
 */
export async function probeSession(
  doFetch: typeof fetch = (...a) => fetch(...a),
): Promise<ScopeState> {
  const mine = ++seq;
  let next: { principal_id: string; scope_id: string } | null = null;
  try {
    const res = await doFetch(SESSION_URL, {
      headers: {
        "X-Workagent-Client": "local-ui",
        "X-Schema-Version": "workagent/v1",
        "X-Request-Id": crypto.randomUUID(),
      },
      cache: "no-store",
    });
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      if (
        typeof body?.principal_id === "string" &&
        body.principal_id &&
        typeof body.scope_id === "string" &&
        SCOPE.test(body.scope_id)
      )
        next = { principal_id: body.principal_id, scope_id: body.scope_id };
    }
  } catch {
    next = null;
  }
  if (mine !== seq) return state;
  if (state.status === "ready") {
    if (
      !next ||
      next.scope_id !== state.scope_id ||
      next.principal_id !== state.principal_id
    )
      set({ status: "changed" });
  } else if (state.status !== "changed")
    set(next ? { status: "ready", ...next } : { status: "unavailable" });
  return state;
}

/** Binds the explicit demo identity (mock mode only). */
export function bindMockIdentity() {
  if (state.status !== "changed") set({ status: "ready", ...MOCK_IDENTITY });
}

/** Tests only: a fresh page realm. */
export function __resetScopeForTests() {
  state = { status: "checking" };
  seq++;
}

class Fenced extends Error {
  constructor() {
    super("Access for this page isn’t confirmed.");
    this.name = "Fenced";
  }
}

function scoped(store: () => Storage | undefined): Storage {
  const k = (key: string) => {
    const s = boundScope();
    return s ? `${PREFIX}${s}:${key}` : null;
  };
  return {
    get length() {
      return 0;
    },
    key: () => null,
    clear() {
      throw new Fenced(); // never clears other scopes' records
    },
    getItem(key) {
      const full = k(key);
      return full ? (store()?.getItem(full) ?? null) : null;
    },
    setItem(key, value) {
      const full = k(key);
      if (!full) throw new Fenced();
      store()!.setItem(full, value);
    },
    removeItem(key) {
      const full = k(key);
      if (full) store()?.removeItem(full);
    },
  };
}
export const scopedSession = scoped(() => globalThis.sessionStorage);
export const scopedLocal = scoped(() => globalThis.localStorage);

/** IndexedDB scope for staged documents, or null while unknown/fenced. */
export function stagedScope(ws: string, draft: string): string | null {
  const s = boundScope();
  return s ? `scope:v1:${s}:${ws}:${draft}` : null;
}

/** Refused before anything reached the service: definitely not sent. */
export class ScopeRefused extends ApiError {}
export const scopeRefused = () =>
  new ScopeRefused({
    code: "unauthenticated",
    status: 401,
    message:
      "Access for this page changed or couldn’t be confirmed, so nothing was sent.",
  });

/**
 * The page was fenced after this request was sent. The service may have
 * acted on it, so its outcome is unknown (like a lost response) and its
 * exact command is kept for an explicit retry; its result is never shown.
 */
export const fencedOutcome = () =>
  new ApiError({
    code: "transport",
    status: 0,
    message:
      "Access for this page changed after this was sent, so its outcome is unknown. It’s kept to retry exactly.",
  });

/** The scope an operation starts in; pass it to `assertScope` after awaits. */
export const captureScope = boundScope;
/** Throws unless the page is still bound to the scope `captured` began in. */
export function assertScope(captured: string | null) {
  if (!captured || boundScope() !== captured) throw fencedOutcome();
}

/** Set by the proxy when it couldn't confirm identity; nothing forwarded. */
export const IDENTITY_HEADER = "X-Workagent-Identity";
export const identityUnconfirmed = (res: Response) =>
  res.headers.get(IDENTITY_HEADER) === "unconfirmed";

/**
 * Every request goes through here: it carries the scope bound when the page
 * started, and nothing is sent once that scope is unknown or fenced. A
 * refusal of the scope fences the page; nothing is retried.
 */
export async function scopedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  doFetch: typeof fetch = (...a) => fetch(...a),
): Promise<Response> {
  const scope = boundScope();
  if (!scope) throw scopeRefused();
  const given = init.headers;
  let headers: HeadersInit;
  if (given && !(given instanceof Headers) && !Array.isArray(given))
    headers = { ...given, [SCOPE_HEADER]: scope };
  else {
    const h = new Headers(
      given ?? (input instanceof Request ? input.headers : undefined),
    );
    h.set(SCOPE_HEADER, scope);
    headers = h;
  }
  let res: Response;
  try {
    res = await doFetch(input, { ...init, headers });
  } catch (e) {
    if (boundScope() !== scope && !init.signal?.aborted) throw fencedOutcome();
    throw e;
  }
  if (identityUnconfirmed(res)) {
    // The proxy couldn't confirm who is signed in and forwarded nothing.
    fenceScope();
    void res.body?.cancel().catch(() => undefined);
    throw scopeRefused();
  }
  if (boundScope() !== scope) {
    // Fenced while in flight: the request was sent, so its outcome is
    // unknown, and its result belongs to access this page no longer shows.
    void res.body?.cancel().catch(() => undefined);
    throw fencedOutcome();
  }
  if (res.status === 401) fenceScope();
  return res;
}
