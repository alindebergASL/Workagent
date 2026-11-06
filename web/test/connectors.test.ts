import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ConnectorController,
  connectorApi,
  merge,
  parseAuthorizationFlow,
  parseConnectorList,
  parseConnectorStatus,
  type ConnectorApi,
  type ConnectorStatus,
  type ConnectorView,
  type KeyStore,
} from "@/lib/client/connectors";
import { ConnectorPanelView, providerLine } from "@/components/ConnectorPanel";
import { ApiError } from "@/lib/contract/errors";

const WS = "11111111-1111-4111-8111-111111111111";
const WS2 = "22222222-2222-4222-8222-222222222222";
const CID = "33333333-3333-4333-8333-333333333333";
const FLOW = "44444444-4444-4444-8444-444444444444";

const status = (
  over: Partial<Record<keyof ConnectorStatus, unknown>> = {},
) => ({
  connector_id: CID,
  provider: "synthetic",
  account: "Synthetic library",
  resource: "synthetic/catalog",
  effects: ["read"],
  processor: "local-synthetic-mcp",
  state: "connected",
  access_generation: 1,
  expires_at: "2026-10-29T18:00:00Z",
  provider_revocation: "not_requested",
  reason: null,
  ...over,
});
const flow = {
  flow_id: FLOW,
  expires_at: "2026-10-29T12:10:00Z",
  provider: "synthetic",
  account: "Synthetic library",
  resource: "synthetic/catalog",
  effects: ["read"],
  processor: "local-synthetic-mcp",
  retention: "synthetic-only; no private account access",
};
const S = (o?: Parameters<typeof status>[0]) => parseConnectorStatus(status(o));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const noopFn = () => undefined;
/** The real panel markup for a controller snapshot. */
const renderView = (view: ConnectorView) =>
  renderToStaticMarkup(
    createElement(ConnectorPanelView, {
      view,
      zone: "UTC",
      onStart: noopFn,
      onConfirm: noopFn,
      onCancel: noopFn,
      onRevoke: noopFn,
      onRefresh: noopFn,
      onRetry: noopFn,
    }),
  );
const tick = () => new Promise((r) => setTimeout(r, 0));
const denied = () =>
  new ApiError({
    code: "not_found_or_not_authorized",
    status: 404,
    message: "x",
  });
const unknown = () =>
  new ApiError({ code: "transport", status: 0, message: "x" });

function memKeys(): KeyStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  let n = 0;
  return {
    map,
    get(i) {
      if (!map.has(i)) map.set(i, `key-${++n}`);
      return map.get(i)!;
    },
    clear(i) {
      map.delete(i);
    },
  };
}

function fakeApi(over: Partial<ConnectorApi> = {}): ConnectorApi {
  return {
    list: vi.fn(async () => Object.freeze([])),
    status: vi.fn(async () => S()),
    start: vi.fn(async () => parseAuthorizationFlow(flow)),
    complete: vi.fn(async () => S()),
    revoke: vi.fn(async () =>
      S({
        state: "revoked",
        access_generation: 2,
        provider_revocation: "pending",
      }),
    ),
    ...over,
  } as ConnectorApi;
}

describe("strict parsing", () => {
  it("accepts the agreed shapes and freezes them", () => {
    const s = S();
    expect(Object.isFrozen(s)).toBe(true);
    expect(parseConnectorList({ items: [status()] })).toHaveLength(1);
    expect(parseAuthorizationFlow(flow).retention).toContain("synthetic-only");
  });
  it.each([
    ["non-synthetic provider", { provider: "google" }],
    ["write effects", { effects: ["read", "write"] }],
    ["unknown state", { state: "active" }],
    ["unknown provider revocation", { provider_revocation: "done" }],
    ["fractional generation", { access_generation: 1.5 }],
    ["bad id", { connector_id: "abc" }],
    ["bad time", { expires_at: "soon" }],
    ["other resource", { resource: "drive/files" }],
    ["generation 0 (canonical ge=1)", { access_generation: 0 }],
    [
      "naive datetime (canonical AwareDatetime)",
      { expires_at: "2026-10-29T18:00:00" },
    ],
    [
      "uppercase id (canonical lowercase UUID)",
      { connector_id: "ABCDEF00-3333-4333-8333-333333333333" },
    ],
    ["reason over 200 chars", { reason: "x".repeat(201) }],
  ])("refuses %s", (_n, over) => {
    expect(() => parseConnectorStatus(status(over))).toThrow();
  });
  it("accepts an omitted reason (canonical default null) and an offset time", () => {
    const noReason: Record<string, unknown> = status({
      expires_at: "2026-10-29T18:00:00+00:00",
    });
    delete noReason.reason;
    expect(parseConnectorStatus(noReason).reason).toBeNull();
  });
  it("drops extra fields such as credential handles", () => {
    const s = parseConnectorStatus({
      ...status(),
      token: "secret",
      redirect_url: "https://x",
    });
    expect(JSON.stringify(s)).not.toMatch(/secret|redirect/);
  });
  it("refuses a flow with other retention or a non-read effect", () => {
    expect(() =>
      parseAuthorizationFlow({ ...flow, retention: "forever" }),
    ).toThrow();
    expect(() => parseAuthorizationFlow({ ...flow, effects: [] })).toThrow();
  });
});

describe("transport", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("sends the agreed routes and bodies with the bound scope", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith("/authorization-flows")) return Response.json(flow);
        return Response.json(status());
      }),
    );
    await connectorApi.start(WS, "k1");
    await connectorApi.complete(WS, FLOW, "k2");
    await connectorApi.revoke(WS, CID, 1, "k3");
    expect(calls.map((c) => c.url)).toEqual([
      `/api/domain/v1/workspaces/${WS}/connectors/authorization-flows`,
      `/api/domain/v1/workspaces/${WS}/connectors/authorization-flows/${FLOW}/complete`,
      `/api/domain/v1/workspaces/${WS}/connectors/${CID}/revoke`,
    ]);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      resource: "synthetic/catalog",
      idempotency_key: "k1",
    });
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({
      expected_generation: 1,
      idempotency_key: "k3",
    });
    expect(
      (calls[0]!.init.headers as Record<string, string>)["X-Workagent-Scope"],
    ).toMatch(/^c{64}$/);
  });
  it("never carries server error text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "validation_failed",
              message: "Traceback: db at 10.0.0.1",
            },
          },
          { status: 422 },
        ),
      ),
    );
    const e = await connectorApi.list(WS).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).message).not.toMatch(/Traceback|10\.0/);
  });
  // The canonical backend ErrorEnvelope is top-level {code, message, ...}.
  const envelope = (code: string, status: number) =>
    Response.json(
      {
        code,
        message: "Traceback at /srv/db 10.0.0.1",
        request_id: "r1",
        next_action: "server text",
        details: {},
      },
      { status },
    );

  it("a top-level 409 version_conflict on revoke rereads the current status", async () => {
    let lists = 0;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/revoke")) return envelope("version_conflict", 409);
      if (url.endsWith("/connectors")) {
        lists++;
        return Response.json({
          items: [
            lists === 1
              ? status()
              : status({
                  state: "revoked",
                  access_generation: 2,
                  provider_revocation: "failed",
                }),
          ],
        });
      }
      throw new Error(`unexpected ${init.method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const c = new ConnectorController(connectorApi, memKeys);
    c.bind(WS);
    await vi.waitFor(() => expect(c.snapshot().items).toHaveLength(1));
    await c.revoke(CID);
    await vi.waitFor(() => expect(lists).toBe(2));
    await vi.waitFor(() =>
      expect(c.snapshot().items?.[0]?.state).toBe("revoked"),
    );
    expect(c.snapshot().notice).toEqual({ kind: "changed" });
    expect(c.snapshot().busy).toBeNull();
    const html = renderView(c.snapshot());
    expect(html).toContain("Access changed since this was shown");
    expect(html).toContain("Provider revocation failed");
    expect(html).not.toMatch(/Traceback|10\.0\.0\.1|server text/);
  });

  it.each([
    ["not_found_or_not_authorized", 404],
    ["unauthenticated", 401],
  ])("a top-level %s refresh clears everything shown", async (code, st) => {
    let deny = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        deny ? envelope(code, st) : Response.json({ items: [status()] }),
      ),
    );
    const c = new ConnectorController(connectorApi, memKeys);
    c.bind(WS);
    await vi.waitFor(() => expect(c.snapshot().items).toHaveLength(1));
    deny = true;
    await c.refresh();
    expect(c.snapshot()).toMatchObject({
      items: null,
      flow: null,
      notice: { kind: "denied" },
    });
    const html = renderView(c.snapshot());
    expect(html).not.toContain("synthetic/catalog");
    expect(html).not.toContain("Revoke access");
    expect(html).toContain("aren’t available to you");
    expect(html).not.toMatch(/Traceback|server text/);
  });

  it("maps top-level codes; an unrelated 409 is a definite refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope("command_conflict", 409)),
    );
    const e = (await connectorApi
      .revoke(WS, CID, 1, "k")
      .catch((x: unknown) => x)) as ApiError;
    expect(e.code).toBe("invalid_request");
    expect(e.message).toBe("refused");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope("version_conflict", 409)),
    );
    const v = (await connectorApi
      .revoke(WS, CID, 1, "k")
      .catch((x: unknown) => x)) as ApiError;
    expect(v.code).toBe("version_conflict");
  });

  it("treats an off-contract success as an unknown outcome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ...status(), provider: "github" })),
    );
    const e = (await connectorApi
      .revoke(WS, CID, 1, "k")
      .catch((x: unknown) => x)) as ApiError;
    expect(e.code).toBe("transport");
  });
});

describe("controller", () => {
  it("starts empty, then start → confirm → readback", async () => {
    const api = fakeApi();
    const c = new ConnectorController(api, memKeys);
    c.bind(WS);
    await tick();
    expect(c.snapshot().items).toEqual([]);
    await c.start();
    expect(c.snapshot().flow?.flow_id).toBe(FLOW);
    await c.confirm();
    await tick();
    expect(c.snapshot().flow).toBeNull();
    expect(c.snapshot().items?.[0]?.state).toBe("connected");
    expect(api.status).toHaveBeenCalledWith(WS, CID);
  });

  it("cancel is local: nothing is sent", async () => {
    const api = fakeApi();
    const c = new ConnectorController(api, memKeys);
    c.bind(WS);
    await tick();
    await c.start();
    c.cancel();
    expect(c.snapshot().flow).toBeNull();
    expect(api.complete).not.toHaveBeenCalled();
  });

  it("a denied refresh clears everything shown at once", async () => {
    let fail = false;
    const api = fakeApi({
      list: vi.fn(async () => {
        if (fail) throw denied();
        return Object.freeze([S()]);
      }),
    });
    const c = new ConnectorController(api, memKeys);
    c.bind(WS);
    await tick();
    expect(c.snapshot().items).toHaveLength(1);
    fail = true;
    await c.refresh();
    expect(c.snapshot().items).toBeNull();
    expect(c.snapshot().flow).toBeNull();
    expect(c.snapshot().notice).toEqual({ kind: "denied" });
  });

  it("drops a response for a workspace no longer shown", async () => {
    const d = deferred<readonly ConnectorStatus[]>();
    const api = fakeApi({
      list: vi.fn((ws: string) =>
        ws === WS ? d.promise : Promise.resolve(Object.freeze([])),
      ),
    });
    const c = new ConnectorController(api, memKeys);
    c.bind(WS);
    c.bind(WS2);
    await tick();
    d.resolve(Object.freeze([S()]));
    await tick();
    expect(c.snapshot().ws).toBe(WS2);
    expect(c.snapshot().items).toEqual([]);
  });

  it("drops an older read that resolves after a newer one", async () => {
    const first = deferred<readonly ConnectorStatus[]>();
    let n = 0;
    const api = fakeApi({
      list: vi.fn(() =>
        ++n === 1
          ? first.promise
          : Promise.resolve(Object.freeze([S({ access_generation: 3 })])),
      ),
    });
    const c = new ConnectorController(api, memKeys);
    c.bind(WS);
    await c.refresh();
    first.resolve(Object.freeze([S({ access_generation: 1 })]));
    await tick();
    expect(c.snapshot().items?.[0]?.access_generation).toBe(3);
  });

  it("unbinding (unmount) drops results in flight", async () => {
    const d = deferred<readonly ConnectorStatus[]>();
    const c = new ConnectorController(
      fakeApi({ list: vi.fn(() => d.promise) }),
      memKeys,
    );
    c.bind(WS);
    c.bind(null);
    d.resolve(Object.freeze([S()]));
    await tick();
    expect(c.snapshot()).toMatchObject({ ws: null, items: null });
  });

  it("revoke ignores a stale connected status that was read before it", async () => {
    const stale = deferred<readonly ConnectorStatus[]>();
    let n = 0;
    const api = fakeApi({
      list: vi.fn(() =>
        ++n === 1 ? Promise.resolve(Object.freeze([S()])) : stale.promise,
      ),
      status: vi.fn(async () =>
        S({
          state: "revoked",
          access_generation: 2,
          provider_revocation: "pending",
        }),
      ),
    });
    const c = new ConnectorController(api, memKeys);
    c.bind(WS);
    await tick();
    void c.refresh(); // in flight, will answer with the old connected status
    await c.revoke(CID);
    stale.resolve(Object.freeze([S()]));
    await tick();
    const s = c.snapshot().items![0]!;
    expect(s.state).toBe("revoked");
    expect(s.provider_revocation).toBe("pending");
    expect(api.revoke).toHaveBeenCalledWith(WS, CID, 1, "key-1");
  });

  it("an older generation in a later list never reopens revoked access", () => {
    const revoked = S({
      state: "revoked",
      access_generation: 2,
      provider_revocation: "failed",
    });
    expect(merge([revoked], S({ access_generation: 1 }))[0]).toBe(revoked);
    expect(merge([revoked], S({ access_generation: 2 }))[0]).toBe(revoked);
  });

  it("an unknown revoke keeps its key; explicit retry sends the same request", async () => {
    let n = 0;
    const api = fakeApi({
      list: vi.fn(async () => Object.freeze([S()])),
      revoke: vi.fn(async () => {
        if (++n === 1) throw unknown();
        return S({
          state: "revoked",
          access_generation: 2,
          provider_revocation: "failed",
        });
      }),
    });
    const keys = memKeys();
    const c = new ConnectorController(api, () => keys);
    c.bind(WS);
    await tick();
    await c.revoke(CID);
    expect(c.snapshot().notice).toEqual({
      kind: "unknown",
      action: `revoke:${CID}`,
    });
    expect(api.revoke).toHaveBeenCalledTimes(1); // never replayed by itself
    await c.revoke(CID);
    const [a, b] = (api.revoke as ReturnType<typeof vi.fn>).mock.calls;
    expect(a![3]).toBe(b![3]);
    expect(keys.map.size).toBe(0);
  });

  it("a version conflict on revoke rereads the current status", async () => {
    const api = fakeApi({
      list: vi.fn(async () => Object.freeze([S()])),
      revoke: vi.fn(async () => {
        throw new ApiError({
          code: "version_conflict",
          status: 409,
          message: "x",
        });
      }),
    });
    const c = new ConnectorController(api, memKeys);
    c.bind(WS);
    await tick();
    await c.revoke(CID);
    await tick();
    expect(c.snapshot().notice).toEqual({ kind: "changed" });
    expect(api.list).toHaveBeenCalledTimes(2);
  });
});

describe("panel markup", () => {
  const base: ConnectorView = {
    ws: WS,
    loading: false,
    items: [],
    flow: null,
    busy: null,
    notice: null,
  };
  const noop = () => undefined;
  const render = (view: Partial<ConnectorView>) =>
    renderToStaticMarkup(
      createElement(ConnectorPanelView, {
        view: { ...base, ...view },
        zone: "UTC",
        onStart: noop,
        onConfirm: noop,
        onCancel: noop,
        onRevoke: noop,
        onRefresh: noop,
        onRetry: noop,
      }),
    );

  it("always says synthetic only and offers no real account", () => {
    const html = render({});
    expect(html).toContain("Synthetic only.");
    expect(html).toContain("Connecting real accounts isn’t available yet");
    expect(html).toContain("Nothing connected.");
    expect(html).toContain("Connect synthetic library");
    expect(html).not.toMatch(/sign in with|oauth/i);
  });

  it("shows what consent covers before the explicit confirm", () => {
    const html = render({ flow: parseAuthorizationFlow(flow) });
    for (const t of [
      "Synthetic library",
      "synthetic/catalog",
      "Read only",
      "local-synthetic-mcp",
      "Synthetic data only; no private account access.",
      "Oct 29, 2026",
      "Confirm synthetic connection",
      "Cancel",
    ])
      expect(html).toContain(t);
  });

  it("distinguishes local revoke from provider pending / failed / confirmed", () => {
    const pending = render({
      items: [
        S({
          state: "revoked",
          access_generation: 2,
          provider_revocation: "pending",
        }),
      ],
    });
    expect(pending).toContain("Local access revoked");
    expect(pending).toContain("Provider revocation pending");
    expect(pending).not.toContain("Provider revocation confirmed");
    const failed = render({
      items: [
        S({
          state: "revoked",
          access_generation: 2,
          provider_revocation: "failed",
        }),
      ],
    });
    expect(failed).toContain("Provider revocation failed");
    expect(failed).not.toContain("confirmed.");
    expect(
      providerLine(S({ state: "revoked", provider_revocation: "revoked" })),
    ).toBe("Provider revocation confirmed.");
    expect(render({ items: [S()] })).toContain("Revoke access");
  });

  it("never renders the server's reason text", () => {
    const html = render({
      items: [
        S({ state: "unavailable", reason: "<script>stack trace</script>" }),
      ],
    });
    expect(html).not.toContain("stack trace");
    expect(html).toContain("Not connected");
  });

  it("says plainly when access ends, ended, or would have ended", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const gone = new Date(Date.now() - 86400000).toISOString();
    const u = render({
      items: [S({ state: "unavailable", expires_at: future })],
    });
    expect(u).toContain("Access ends ");
    expect(u).not.toContain("ended or ends");
    expect(
      render({ items: [S({ state: "unavailable", expires_at: gone })] }),
    ).toContain("Access ended ");
    expect(
      render({ items: [S({ state: "revoked", expires_at: future })] }),
    ).toContain("Would have ended ");
  });

  it("says why a row isn't connected, by known reason only", () => {
    expect(
      render({
        items: [
          S({ state: "unavailable", reason: "awaiting_synthetic_consent" }),
        ],
      }),
    ).toContain("Not connected · setup wasn’t finished");
    expect(
      render({
        items: [
          S({
            state: "unavailable",
            reason: "synthetic_fixture_not_configured",
          }),
        ],
      }),
    ).toContain("the connection service isn’t available right now");
    const past = new Date(Date.now() - 86400000).toISOString();
    expect(
      render({
        items: [
          S({
            state: "unavailable",
            reason: "awaiting_synthetic_consent",
            expires_at: past,
          }),
        ],
      }),
    ).toContain("Setup request expired ");
  });

  it("denied shows nothing from before", () => {
    const html = render({ items: null, notice: { kind: "denied" } });
    expect(html).not.toContain("synthetic/catalog");
    expect(html).toContain("aren’t available to you");
  });

  it("styles wrap at 1440, 390 and 320 px (no fixed widths)", () => {
    const css = readFileSync(
      path.resolve(import.meta.dirname, "../src/styles/products.css"),
      "utf8",
    );
    const block = css.slice(css.indexOf("Synthetic connections (B3.3b)"));
    expect(block).toContain("overflow-wrap: anywhere");
    expect(block).toContain("@media (max-width: 400px)");
    expect(block).not.toMatch(/^\s*width:\s*\d+px/m);
  });
});
