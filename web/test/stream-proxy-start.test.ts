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
  new Promise<Response>((_, reject) =>
    signal.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError")),
    ),
  );
const opens = async () =>
  new Response(new ReadableStream(), {
    headers: { "content-type": "text/event-stream" },
  });

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
});
