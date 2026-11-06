/**
 * The live work stream through the proxy: no overall limit once it has
 * started, but it must start within 15 seconds, and the page leaving closes
 * it upstream. A backend that accepts and never answers would otherwise hold
 * the page on "connecting" with no fallback to polling.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const A = "a".repeat(64);
const BEARER = "x".repeat(40);
const BACKEND = "http://127.0.0.1:18965";
const ORIGIN = "http://127.0.0.1:3195";
const scope = createHmac("sha256", BEARER)
  .update(`workagent-web-scope/v1\n${BACKEND}\n${A}`)
  .digest("hex");
const STREAM = ["v1", "workspaces", "ws", "events", "stream"];

const req = (page: AbortController) =>
  [
    {
      method: "GET",
      headers: new Headers({
        host: "127.0.0.1:3195",
        "x-workagent-client": "local-ui",
        "x-workagent-scope": scope,
      }),
      nextUrl: { search: "?conversation_id=cv" },
      body: null,
      signal: page.signal,
    } as never,
    { params: Promise.resolve({ path: STREAM }) },
  ] as const;

/** The stream request's signal, once the proxy has forwarded it. */
let streamSignal: () => AbortSignal | undefined;
function backend(stream: (signal: AbortSignal) => Promise<Response>) {
  let signal: AbortSignal | undefined;
  streamSignal = () => signal;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/v1/session"))
        return Response.json({ principal_id: "local-human", scope_id: A });
      signal = init.signal!;
      return stream(signal);
    }),
  );
}
const hangs = (signal: AbortSignal) =>
  new Promise<Response>((_, reject) => {
    // Like fetch: rejects at once if the signal is already aborted.
    const abort = () => reject(new DOMException("aborted", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
const opens = async () =>
  new Response(new ReadableStream(), {
    headers: { "content-type": "text/event-stream" },
  });
/** An open upstream stream whose feed and cancellation are observable. */
function observable() {
  let feed: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = vi.fn();
  const opens = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start: (c) => void (feed = c),
        cancel: cancelled,
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  return { opens, cancelled, feed: (bytes: Uint8Array) => feed.enqueue(bytes) };
}
const frame = new TextEncoder().encode(": keepalive\n\n");

beforeEach(() => {
  vi.stubEnv("LOCAL_TEST_MODE", "true");
  vi.stubEnv("LOCAL_BEARER_TOKEN", BEARER);
  vi.stubEnv("WORKAGENT_WEB_ORIGIN", ORIGIN);
  vi.stubEnv("WORKAGENT_BACKEND_URL", BACKEND);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const mod = () => import("@/app/api/domain/[...path]/route");

describe("live work stream through the proxy", () => {
  it("gives up if the stream doesn't start within 15 seconds", async () => {
    vi.useFakeTimers();
    backend(hangs);
    const pending = (await mod()).GET(...req(new AbortController()));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(streamSignal()?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("action_unresolved");
  });

  it("keeps a started stream open past 15 seconds", async () => {
    vi.useFakeTimers();
    backend(opens);
    const res = await (await mod()).GET(...req(new AbortController()));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(streamSignal()?.aborted).toBe(false);
  });

  it("closes the stream upstream when the page goes away", async () => {
    backend(opens);
    const page = new AbortController();
    await (await mod()).GET(...req(page));
    expect(streamSignal()?.aborted).toBe(false);
    page.abort();
    expect(streamSignal()?.aborted).toBe(true);
  });

  it("answers at once when the page goes away before the upstream connects", async () => {
    backend(hangs);
    const page = new AbortController();
    const pending = (await mod()).GET(...req(page));
    page.abort();
    const res = await pending;
    expect(res.status).toBe(502);
    expect(streamSignal()?.aborted).toBe(true);
  });

  it("cancels the upstream reader and ends the response when the browser disconnects mid-stream", async () => {
    const upstream = observable();
    backend(upstream.opens);
    const page = new AbortController();
    const res = await (await mod()).GET(...req(page));
    const reader = res.body!.getReader();
    upstream.feed(frame);
    expect((await reader.read()).done).toBe(false);
    page.abort();
    // The upstream connection is released, and this response ends so the
    // in-flight request drains instead of holding the server open.
    expect(upstream.cancelled).toHaveBeenCalled();
    expect((await reader.read()).done).toBe(true);
  });

  it("closes the stream upstream when the response body is cancelled", async () => {
    // Next cancels the response body when the browser's socket closes,
    // even if the request signal never fires.
    const upstream = observable();
    backend(upstream.opens);
    const res = await (await mod()).GET(...req(new AbortController()));
    await res.body!.cancel();
    expect(upstream.cancelled).toHaveBeenCalled();
    expect(streamSignal()?.aborted).toBe(true);
  });

  it("aborts live streams on shutdown so the server can drain", async () => {
    const { drainLiveStreams, shutdownHandler } = await import(
      "@/lib/server/live-streams"
    );
    const upstream = observable();
    backend(upstream.opens);
    const res = await (await mod()).GET(...req(new AbortController()));
    const reader = res.body!.getReader();
    expect(streamSignal()?.aborted).toBe(false);
    drainLiveStreams();
    expect(streamSignal()?.aborted).toBe(true);
    expect(upstream.cancelled).toHaveBeenCalled();
    expect((await reader.read()).done).toBe(true);
    // The same drain is wired, exactly once, to the process shutdown
    // signals; it only aborts streams, it never exits the process.
    const handler = shutdownHandler();
    expect(handler).toBeDefined();
    for (const signal of ["SIGTERM", "SIGINT"] as const)
      expect(
        process.listeners(signal).filter((l) => l === handler),
      ).toHaveLength(1);
  });

  it("leaves nothing registered once a stream has ended", async () => {
    const { liveStreamCount } = await import("@/lib/server/live-streams");
    // Aborted before the upstream connects: the 502 deregisters it.
    backend(hangs);
    const before = liveStreamCount();
    let page = new AbortController();
    const pending = (await mod()).GET(...req(page));
    page.abort();
    expect((await pending).status).toBe(502);
    expect(liveStreamCount()).toBe(before);
    // Disconnected mid-stream: ending the relay deregisters it.
    const upstream = observable();
    backend(upstream.opens);
    page = new AbortController();
    const res = await (await mod()).GET(...req(page));
    expect(liveStreamCount()).toBe(before + 1);
    page.abort();
    expect((await res.body!.getReader().read()).done).toBe(true);
    expect(liveStreamCount()).toBe(before);
  });
});
