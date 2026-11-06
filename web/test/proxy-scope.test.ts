/** A14 proxy: session discovery and request-time scope fence. */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const A = "a".repeat(64);
const B = "b".repeat(64);
const BEARER = "x".repeat(40);
const BACKEND = "http://127.0.0.1:18965";
const ORIGIN = "http://127.0.0.1:3195";
const browserScope = (backend: string, scope: string) =>
  createHmac("sha256", BEARER)
    .update(`workagent-web-scope/v1\n${backend}\n${scope}`)
    .digest("hex");
const req = (
  path: string[],
  method = "GET",
  headers: Record<string, string> = {},
) =>
  [
    {
      method,
      headers: new Headers({
        host: "127.0.0.1:3195",
        "x-workagent-client": "local-ui",
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
        ...headers,
      }),
      nextUrl: { search: "" },
      body: method === "POST" ? new Blob(["{}"]).stream() : null,
      signal: new AbortController().signal,
    } as never,
    { params: Promise.resolve({ path }) },
  ] as const;
const forwarded = (m: ReturnType<typeof vi.fn>) =>
  m.mock.calls.filter(([u]) => !String(u).endsWith("/v1/session"));

let upstream: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("LOCAL_TEST_MODE", "true");
  vi.stubEnv("LOCAL_BEARER_TOKEN", BEARER);
  vi.stubEnv("WORKAGENT_WEB_ORIGIN", ORIGIN);
  vi.stubEnv("WORKAGENT_BACKEND_URL", BACKEND);
  upstream = vi.fn(async (url: string) =>
    url.endsWith("/v1/session")
      ? Response.json({ principal_id: "local-human", scope_id: A })
      : Response.json({ items: [] }),
  );
  vi.stubGlobal("fetch", upstream);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const mod = () => import("@/app/api/domain/[...path]/route");

describe("proxy scope contract", () => {
  it("session returns only principal and an endpoint-bound browser scope", async () => {
    const res = await (await mod()).GET(...req(["v1", "session"]));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      principal_id: "local-human",
      scope_id: browserScope(BACKEND, A),
    });
    expect(text).not.toContain(A);
    expect(text).not.toContain(BEARER);
    expect(text).not.toContain("18965");
    const h = new Headers((upstream.mock.calls[0]![1] as RequestInit).headers);
    expect(h.get("authorization")).toBe(`Bearer ${BEARER}`);
    expect(h.get("x-schema-version")).toBe("workagent/v1");
    expect(h.get("x-request-id")).toBeTruthy();
  });

  it("endpoint-only change changes the browser scope", async () => {
    vi.stubEnv("WORKAGENT_BACKEND_URL", "http://127.0.0.1:18966");
    const res = await (await mod()).GET(...req(["v1", "session"]));
    const body = (await res.json()) as { scope_id: string };
    expect(body.scope_id).toBe(browserScope("http://127.0.0.1:18966", A));
    expect(body.scope_id).not.toBe(browserScope(BACKEND, A));
  });

  it("absent or stale scope is refused before forwarding any read or write", async () => {
    const path = ["v1", "workspaces", "ws1", "conversations", "c1", "messages"];
    for (const h of [
      {} as Record<string, string>,
      { "x-workagent-scope": browserScope(BACKEND, B) },
      { "x-workagent-scope": A },
    ]) {
      upstream.mockClear();
      const res = await (await mod()).POST(...req(path, "POST", h));
      expect(res.status).toBe(401);
      const g = await (await mod()).GET(...req(["v1", "workspaces"], "GET", h));
      expect(g.status).toBe(401);
      expect(forwarded(upstream)).toHaveLength(0);
    }
  });

  it("matching scope forwards once with the backend scope fence", async () => {
    upstream.mockClear();
    const res = await (
      await mod()
    ).POST(
      ...req(["v1", "workspaces", "ws1", "x"], "POST", {
        "x-workagent-scope": browserScope(BACKEND, A),
      }),
    );
    expect(res.status).toBe(200);
    expect(forwarded(upstream)).toHaveLength(1);
    const h = new Headers((forwarded(upstream)[0]![1] as RequestInit).headers);
    expect(h.get("x-workagent-scope")).toBe(A);
  });

  it("session failure fails closed for session and every other request", async () => {
    upstream.mockImplementation(async () => {
      throw new TypeError("socket");
    });
    const res = await (await mod()).GET(...req(["v1", "session"]));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const g = await (
      await mod()
    ).GET(
      ...req(["v1", "workspaces"], "GET", {
        "x-workagent-scope": browserScope(BACKEND, A),
      }),
    );
    expect(g.status).toBeGreaterThanOrEqual(400);
    expect(forwarded(upstream)).toHaveLength(0);
  });

  it("a revoked backend session is refused, not forwarded", async () => {
    upstream.mockImplementation(async () =>
      Response.json({ code: "unauthenticated" }, { status: 401 }),
    );
    const res = await (await mod()).GET(...req(["v1", "session"]));
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(BEARER);
  });
});
