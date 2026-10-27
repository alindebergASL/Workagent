import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../src/app/api/domain/[...path]/route";

const params = {
  params: Promise.resolve({
    path: ["v1", "workspaces", "w", "events", "stream"],
  }),
};
const url =
  "http://127.0.0.1:3000/api/domain/v1/workspaces/w/events/stream?after=c1";
const local = { host: "127.0.0.1:3000", "x-workagent-client": "local-ui" };

function setup(response: () => Response) {
  vi.stubEnv("LOCAL_TEST_MODE", "true");
  vi.stubEnv(
    "LOCAL_BEARER_TOKEN",
    "synthetic-test-bearer-not-a-secret".padEnd(40, "x"),
  );
  const upstream = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    async () => response(),
  );
  vi.stubGlobal("fetch", upstream);
  return upstream;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("same-origin live updates proxy", () => {
  it("passes the event stream through unbuffered, with credentials only upstream", async () => {
    const upstream = setup(
      () =>
        new Response("id: c2\ndata: {}\n\n", {
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        }),
    );
    const res = await GET(new NextRequest(url, { headers: local }), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(await res.text()).toBe("id: c2\ndata: {}\n\n");
    const [target, init] = upstream.mock.calls[0]!;
    expect(target).toBe(
      "http://127.0.0.1:8000/v1/workspaces/w/events/stream?after=c1",
    );
    const h = init.headers as Record<string, string>;
    expect(h.Accept).toBe("text/event-stream");
    expect(h.Authorization).toMatch(/^Bearer /);
    expect(res.headers.get("authorization")).toBeNull();
  });

  it("keeps an open stream past the ordinary 15-second limit", async () => {
    // A fixed overall timeout (the ordinary requests' AbortSignal.timeout)
    // would cut every stream; only the wait for it to start is limited.
    const overall = vi.spyOn(AbortSignal, "timeout");
    vi.useFakeTimers();
    const upstream = setup(
      () =>
        new Response(new ReadableStream(), {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    await GET(new NextRequest(url, { headers: local }), params);
    const signal = upstream.mock.calls[0]![1].signal!;
    vi.advanceTimersByTime(60_000);
    expect(signal.aborted).toBe(false);
    expect(overall).not.toHaveBeenCalled();
    overall.mockRestore();
  });

  it("closes the upstream stream when the page goes away", async () => {
    const upstream = setup(
      () =>
        new Response(new ReadableStream(), {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const page = new AbortController();
    await GET(
      new NextRequest(url, { headers: local, signal: page.signal }),
      params,
    );
    const signal = upstream.mock.calls[0]![1].signal!;
    expect(signal.aborted).toBe(false);
    page.abort();
    expect(signal.aborted).toBe(true);
  });

  it("gives up if the stream doesn't start, and says so plainly", async () => {
    vi.useFakeTimers();
    vi.stubEnv("LOCAL_TEST_MODE", "true");
    vi.stubEnv(
      "LOCAL_BEARER_TOKEN",
      "synthetic-test-bearer-not-a-secret".padEnd(40, "x"),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise<Response>((_, reject) =>
            init.signal!.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      ),
    );
    const pending = GET(new NextRequest(url, { headers: local }), params);
    await vi.advanceTimersByTimeAsync(15_000);
    const res = await pending;
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("action_unresolved");
  });

  it("labels a server without the stream as JSON, for the page to fall back", async () => {
    setup(() => Response.json({ code: "not_found" }, { status: 404 }));
    const res = await GET(new NextRequest(url, { headers: local }), params);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("refuses a request that isn't from this app's pages", async () => {
    const upstream = setup(() => new Response(""));
    const res = await GET(
      new NextRequest(url, { headers: { host: "127.0.0.1:3000" } }),
      params,
    );
    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
});
