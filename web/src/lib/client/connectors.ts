/**
 * Synthetic connector consent, status and revoke (B3.3b).
 *
 * The only resource offered is the local synthetic library: explicit consent
 * to a read-only synthetic catalog, not a login to any private account.
 * Responses are parsed strictly into frozen snapshots and anything that
 * doesn't match the agreed shape is refused, never shown. Nothing here
 * carries or renders credentials, codes, tokens, redirect URLs or server
 * error text.
 *
 * Temporary local parsing until the generated workagent/v1 client includes
 * the connector routes; the shapes below are the contract agreed with the
 * backend lane.
 */
import { ApiError } from "@/lib/contract/errors";
import {
  assertScope,
  boundScope,
  captureScope,
  scopedFetch,
  scopedSession,
} from "./session-scope";

export const SYNTHETIC_RESOURCE = "synthetic/catalog" as const;

export type ConnectorState =
  "connected" | "revoked" | "expired" | "unavailable";
export type ProviderRevocation =
  "not_requested" | "pending" | "failed" | "revoked";

export interface ConnectorStatus {
  readonly connector_id: string;
  readonly provider: "synthetic";
  readonly account: "Synthetic library";
  readonly resource: typeof SYNTHETIC_RESOURCE;
  readonly effects: readonly ["read"];
  readonly processor: "local-synthetic-mcp";
  readonly state: ConnectorState;
  readonly access_generation: number;
  readonly expires_at: string;
  readonly provider_revocation: ProviderRevocation;
  readonly reason: string | null;
}

export interface AuthorizationFlow {
  readonly flow_id: string;
  readonly expires_at: string;
  readonly provider: "synthetic";
  readonly account: "Synthetic library";
  readonly resource: typeof SYNTHETIC_RESOURCE;
  readonly effects: readonly ["read"];
  readonly processor: "local-synthetic-mcp";
  readonly retention: "synthetic-only; no private account access";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATES = new Set<string>([
  "connected",
  "revoked",
  "expired",
  "unavailable",
]);
const REVOCATIONS = new Set<string>([
  "not_requested",
  "pending",
  "failed",
  "revoked",
]);
const RETENTION = "synthetic-only; no private account access";

class ShapeError extends Error {}
const fail = (): never => {
  throw new ShapeError("unexpected connector response");
};
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : fail();
const uuid = (v: unknown): string =>
  typeof v === "string" && UUID.test(v) ? v : fail();
const time = (v: unknown): string =>
  // AwareDatetime: an explicit offset is required.
  typeof v === "string" &&
  /(Z|[+-]\d{2}:?\d{2})$/i.test(v) &&
  !Number.isNaN(Date.parse(v))
    ? v
    : fail();
const exact = <T extends string>(v: unknown, want: T): T =>
  v === want ? want : fail();
const readOnly = (v: unknown): readonly ["read"] =>
  Array.isArray(v) && v.length === 1 && v[0] === "read"
    ? Object.freeze(["read"] as const)
    : fail();

function syntheticBase(o: Record<string, unknown>) {
  return {
    provider: exact(o.provider, "synthetic"),
    account: exact(o.account, "Synthetic library"),
    resource: exact(o.resource, SYNTHETIC_RESOURCE),
    effects: readOnly(o.effects),
    processor: exact(o.processor, "local-synthetic-mcp"),
  };
}

/** A frozen copy of one status; throws on anything off-contract. */
export function parseConnectorStatus(raw: unknown): ConnectorStatus {
  const o = obj(raw);
  const gen = o.access_generation;
  if (typeof gen !== "number" || !Number.isSafeInteger(gen) || gen < 1) fail();
  const state =
    typeof o.state === "string" && STATES.has(o.state) ? o.state : fail();
  const rev =
    typeof o.provider_revocation === "string" &&
    REVOCATIONS.has(o.provider_revocation)
      ? o.provider_revocation
      : fail();
  // Optional in the canonical model (defaults to null); never rendered.
  const reason =
    o.reason === null || o.reason === undefined
      ? null
      : typeof o.reason === "string" && o.reason.length <= 200
        ? o.reason
        : fail();
  return Object.freeze({
    connector_id: uuid(o.connector_id),
    ...syntheticBase(o),
    state: state as ConnectorState,
    access_generation: gen as number,
    expires_at: time(o.expires_at),
    provider_revocation: rev as ProviderRevocation,
    reason,
  });
}

export function parseConnectorList(raw: unknown): readonly ConnectorStatus[] {
  const items = obj(raw).items;
  if (!Array.isArray(items)) fail();
  return Object.freeze((items as unknown[]).map(parseConnectorStatus));
}

export function parseAuthorizationFlow(raw: unknown): AuthorizationFlow {
  const o = obj(raw);
  return Object.freeze({
    flow_id: uuid(o.flow_id),
    expires_at: time(o.expires_at),
    ...syntheticBase(o),
    retention: exact(o.retention, RETENTION),
  });
}

// ---- transport ------------------------------------------------------------

const base = (ws: string) =>
  `/api/domain/v1/workspaces/${encodeURIComponent(ws)}/connectors`;

/**
 * One request. Every failure becomes a fixed-copy ApiError: a definite
 * refusal (4xx) or an unknown outcome ("transport"); the server's own text
 * is never carried.
 */
async function call<T>(
  url: string,
  parse: (raw: unknown) => T,
  init: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const scope = captureScope();
  let res: Response;
  try {
    res = await scopedFetch(url, {
      method: init.method ?? "GET",
      headers: {
        "X-Workagent-Client": "local-ui",
        "X-Schema-Version": "workagent/v1",
        "X-Request-Id": crypto.randomUUID(),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: init.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    if (e instanceof ApiError) throw e;
    throw unknownOutcome();
  }
  // Refused sign-in is a definite denial (the page is fenced by now).
  if (res.status === 401)
    throw new ApiError({
      code: "unauthenticated",
      status: 401,
      message: "refused",
    });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  assertScope(scope);
  if (!res.ok) {
    const code = codeOf(body);
    throw new ApiError({
      code:
        res.status >= 500
          ? "transport"
          : res.status === 401
            ? "unauthenticated"
            : res.status === 403 || res.status === 404
              ? "not_found_or_not_authorized"
              : code === "version_conflict"
                ? "version_conflict"
                : "invalid_request",
      status: res.status,
      message: "refused",
    });
  }
  try {
    return parse(body);
  } catch {
    // The request succeeded but what came back can't be trusted; for a
    // write that means its outcome is unknown.
    throw unknownOutcome();
  }
}

const unknownOutcome = () =>
  new ApiError({ code: "transport", status: 0, message: "unknown outcome" });

/** The canonical ErrorEnvelope is top-level `{code, message, ...}`. */
function codeOf(body: unknown): string | null {
  const code =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { code?: unknown }).code
      : undefined;
  return typeof code === "string" && /^[a-z_]{1,64}$/.test(code) ? code : null;
}

export const connectorApi = {
  list: (ws: string, signal?: AbortSignal) =>
    call(base(ws), parseConnectorList, { signal }),
  status: (ws: string, id: string, signal?: AbortSignal) =>
    call(`${base(ws)}/${encodeURIComponent(id)}/status`, parseConnectorStatus, {
      signal,
    }),
  start: (ws: string, idempotency_key: string) =>
    call(`${base(ws)}/authorization-flows`, parseAuthorizationFlow, {
      method: "POST",
      body: { resource: SYNTHETIC_RESOURCE, idempotency_key },
    }),
  complete: (ws: string, flow: string, idempotency_key: string) =>
    call(
      `${base(ws)}/authorization-flows/${encodeURIComponent(flow)}/complete`,
      parseConnectorStatus,
      { method: "POST", body: { idempotency_key } },
    ),
  revoke: (
    ws: string,
    id: string,
    expected_generation: number,
    idempotency_key: string,
  ) =>
    call(`${base(ws)}/${encodeURIComponent(id)}/revoke`, parseConnectorStatus, {
      method: "POST",
      body: { expected_generation, idempotency_key },
    }),
};
export type ConnectorApi = typeof connectorApi;

// ---- explicit-retry keys ----------------------------------------------------

/**
 * Each write intent keeps its idempotency key until a definite answer, so an
 * explicit retry after an unknown outcome is the same request, never a new
 * one. Kept per scope in session storage (survives a reload in this tab);
 * never replayed automatically.
 */
export interface KeyStore {
  get(intent: string): string;
  clear(intent: string): void;
}
export function sessionKeys(ws: string): KeyStore {
  const k = (intent: string) => `workagent:connector-key:${ws}:${intent}`;
  const memory = new Map<string, string>();
  return {
    get(intent) {
      let key: string | null = memory.get(intent) ?? null;
      try {
        key ??= scopedSession.getItem(k(intent));
      } catch {
        /* storage unavailable: memory only */
      }
      if (!key || !UUID.test(key)) key = crypto.randomUUID();
      memory.set(intent, key);
      try {
        scopedSession.setItem(k(intent), key);
      } catch {
        /* fenced or unavailable: memory only */
      }
      return key;
    },
    clear(intent) {
      memory.delete(intent);
      try {
        scopedSession.removeItem(k(intent));
      } catch {
        /* ignore */
      }
    },
  };
}

// ---- controller -------------------------------------------------------------

export type Notice =
  | { kind: "denied" }
  | { kind: "unknown"; action: Intent }
  | { kind: "refused"; action: Intent }
  | { kind: "changed" }
  | { kind: "unreadable" };

export type Intent = "start" | "confirm" | `revoke:${string}`;

export interface ConnectorView {
  readonly ws: string | null;
  readonly loading: boolean;
  /** Null until the first successful read. */
  readonly items: readonly ConnectorStatus[] | null;
  /** A started consent awaiting explicit confirmation. */
  readonly flow: AuthorizationFlow | null;
  readonly busy: Intent | null;
  readonly notice: Notice | null;
}

const EMPTY: ConnectorView = Object.freeze({
  ws: null,
  loading: false,
  items: null,
  flow: null,
  busy: null,
  notice: null,
});

/**
 * The panel's state outside React. Every read and write is stamped with the
 * workspace and a generation; a response that arrives after the workspace
 * changed, the panel closed, a newer read began or a write landed is
 * dropped. A refusal of access clears everything shown at once.
 */
export class ConnectorController {
  private view: ConnectorView = EMPTY;
  private gen = 0;
  private reading: AbortController | null = null;
  private listeners = new Set<() => void>();
  private keys: KeyStore | null = null;

  constructor(
    private readonly api: ConnectorApi = connectorApi,
    private readonly keyStore: (ws: string) => KeyStore = sessionKeys,
  ) {}

  snapshot = (): ConnectorView => this.view;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  private set(patch: Partial<ConnectorView>) {
    this.view = Object.freeze({ ...this.view, ...patch });
    for (const l of this.listeners) l();
  }

  /** Binds to a workspace (or none); anything shown for another is cleared. */
  bind(ws: string | null) {
    if (ws === this.view.ws) return;
    this.invalidate();
    this.keys = ws ? this.keyStore(ws) : null;
    this.set({ ...EMPTY, ws });
    if (ws) void this.refresh();
  }

  dispose() {
    this.invalidate();
    this.listeners.clear();
  }

  private invalidate() {
    this.gen++;
    this.reading?.abort();
    this.reading = null;
  }

  private current(ws: string, gen: number) {
    return this.view.ws === ws && this.gen === gen;
  }

  async refresh(): Promise<void> {
    const ws = this.view.ws;
    // A write in flight owns the panel; its answer must not be dropped.
    if (!ws || this.view.busy) return;
    this.invalidate();
    const gen = this.gen;
    const ctl = new AbortController();
    this.reading = ctl;
    this.set({ loading: true });
    try {
      const listed = await this.api.list(ws, ctl.signal);
      if (!this.current(ws, gen)) return;
      // What the service lists is what's shown, but never an older
      // generation than one this page already confirmed.
      const prev = this.view.items ?? [];
      const items = Object.freeze(
        listed.map((s) => {
          const p = prev.find((x) => x.connector_id === s.connector_id);
          return p ? merge([p], s)[0]! : s;
        }),
      );
      this.set({ items, loading: false, notice: this.keepNotice() });
    } catch (e) {
      if (!this.current(ws, gen)) return;
      this.failed(e, null);
    } finally {
      if (this.reading === ctl) this.reading = null;
    }
  }

  /** Read failures don't clear an unknown write outcome the person must see. */
  private keepNotice(): Notice | null {
    const n = this.view.notice;
    return n && (n.kind === "unknown" || n.kind === "changed") ? n : null;
  }

  private failed(e: unknown, action: Intent | null) {
    const err = e instanceof ApiError ? e : null;
    if (
      boundScope() === null ||
      (err &&
        (err.code === "unauthenticated" ||
          err.code === "not_found_or_not_authorized"))
    ) {
      // Access refused: nothing from before stays on screen.
      this.invalidate();
      this.set({
        items: null,
        flow: null,
        busy: null,
        loading: false,
        notice: { kind: "denied" },
      });
      return;
    }
    if (!action) {
      this.set({ loading: false, notice: { kind: "unreadable" } });
      return;
    }
    if (err?.code === "version_conflict") {
      this.keys?.clear(action);
      this.set({ busy: null, notice: { kind: "changed" } });
      void this.refresh();
      return;
    }
    if (!err || err.code === "transport") {
      // Outcome unknown: the key is kept so a retry is the same request.
      this.set({ busy: null, notice: { kind: "unknown", action } });
      return;
    }
    this.keys?.clear(action);
    this.set({ busy: null, notice: { kind: "refused", action } });
  }

  private async write<T>(
    action: Intent,
    run: (ws: string, key: string) => Promise<T>,
    apply: (r: T) => void,
  ) {
    const ws = this.view.ws;
    if (!ws || !this.keys || this.view.busy) return;
    const key = this.keys.get(action);
    // A write supersedes any read in flight: its stale result is dropped.
    this.invalidate();
    const gen = this.gen;
    this.set({ busy: action, loading: false, notice: null });
    try {
      const r = await run(ws, key);
      if (!this.current(ws, gen)) return;
      this.keys.clear(action);
      apply(r);
    } catch (e) {
      if (!this.current(ws, gen)) return;
      this.failed(e, action);
    }
  }

  start() {
    return this.write(
      "start",
      (ws, key) => this.api.start(ws, key),
      (flow) => {
        // A new consent is a new confirmation, never an older one retried.
        this.keys?.clear("confirm");
        this.set({ flow, busy: null });
      },
    );
  }

  /** Local only: nothing was granted, so nothing is sent. */
  cancel() {
    if (this.view.busy) return;
    this.keys?.clear("start");
    this.keys?.clear("confirm");
    this.set({ flow: null, notice: null });
  }

  confirm() {
    const flow = this.view.flow;
    if (!flow) return;
    return this.write(
      "confirm",
      (ws, key) => this.api.complete(ws, flow.flow_id, key),
      (status) => {
        this.set({
          flow: null,
          busy: null,
          items: merge(this.view.items, status),
        });
        void this.readback(status.connector_id);
      },
    );
  }

  revoke(id: string) {
    const status = this.view.items?.find((s) => s.connector_id === id);
    if (!status) return;
    return this.write(
      `revoke:${id}`,
      (ws, key) => this.api.revoke(ws, id, status.access_generation, key),
      (next) => {
        this.set({ busy: null, items: merge(this.view.items, next) });
        void this.readback(id);
      },
    );
  }

  /** Reads one status back from the service after a write. */
  private async readback(id: string) {
    const ws = this.view.ws;
    if (!ws) return;
    const gen = this.gen;
    try {
      const s = await this.api.status(ws, id);
      if (!this.current(ws, gen)) return;
      this.set({ items: merge(this.view.items, s) });
    } catch (e) {
      if (!this.current(ws, gen)) return;
      this.failed(e, null);
    }
  }
}

/**
 * Replaces one status, never with an older access generation, and never
 * re-opens access that was already revoked at the same generation.
 */
export function merge(
  items: readonly ConnectorStatus[] | null,
  next: ConnectorStatus,
): readonly ConnectorStatus[] {
  const list = items ?? [];
  const i = list.findIndex((s) => s.connector_id === next.connector_id);
  if (i < 0) return Object.freeze([...list, next]);
  const prev = list[i]!;
  if (next.access_generation < prev.access_generation) return list;
  if (
    next.access_generation === prev.access_generation &&
    prev.state === "revoked" &&
    next.state === "connected"
  )
    return list;
  const out = [...list];
  out[i] = next;
  return Object.freeze(out);
}
