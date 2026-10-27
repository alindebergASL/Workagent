import { describe, expect, it, vi } from "vitest";
import {
  applyEvents,
  emptyFeed,
  subscribeWork,
  type Delivery,
  type FeedOptions,
} from "../src/lib/client/work-events";

type E = { event_id: string; conversation_id: string; version: number };
const keys = {
  id: (e: E) => e.event_id,
  aggregate: (e: E) => [e.conversation_id, e.version] as const,
};
const ev = (id: string, version: number, c = "c"): E => ({
  event_id: id,
  conversation_id: c,
  version,
});

describe("applying work events", () => {
  it("applies each event once, however often it's delivered", () => {
    let s = emptyFeed();
    const a = applyEvents(s, [ev("e1", 1), ev("e1", 1), ev("e2", 2)], keys);
    expect(a.fresh.map((e) => e.event_id)).toEqual(["e1", "e2"]);
    s = a.state;
    expect(applyEvents(s, [ev("e2", 2), ev("e3", 3)], keys).fresh).toEqual([
      ev("e3", 3),
    ]);
  });

  it("skips an event older than what's shown for its aggregate", () => {
    const s = applyEvents(emptyFeed(), [ev("e5", 5)], keys).state;
    const r = applyEvents(s, [ev("e4", 4), ev("x1", 1, "other")], keys);
    expect(r.fresh).toEqual([ev("x1", 1, "other")]);
  });

  it("remembers a bounded number of event IDs", () => {
    const many = Array.from({ length: 1500 }, (_, i) =>
      ev(`e${i}`, i, `c${i}`),
    );
    expect(applyEvents(emptyFeed(), many, keys).state.seen).toHaveLength(1000);
  });
});

const enc = new TextEncoder();
function sse(
  chunks: string[],
  { hold = false }: { hold?: boolean } = {},
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const x of chunks) c.enqueue(enc.encode(x));
      if (!hold) c.close();
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
}
const frame = (id: string, e: E) => `id: ${id}\ndata: ${JSON.stringify(e)}\n\n`;

function harness(
  responses: (Response | Error | ((url: string) => Response))[],
  extra: Partial<FeedOptions<E>> = {},
) {
  const urls: string[] = [];
  const inits: RequestInit[] = [];
  const applied: { events: E[]; cursor: string | null }[] = [];
  const delivery: Delivery[] = [];
  const resets: string[] = [];
  // The feed stops itself once the scripted responses run out.
  const ref: { feed?: ReturnType<typeof subscribeWork<E>> } = {};
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    urls.push(url);
    inits.push(init);
    const next = responses.shift();
    if (!next) {
      ref.feed!.stop();
      throw new DOMException("stopped", "AbortError");
    }
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(url) : next;
  }) as unknown as typeof fetch;
  const feed = (ref.feed = subscribeWork<E>({
    ...keys,
    after: "start",
    streamUrl: (a) => `/stream?after=${a}`,
    pageUrl: (a) => `/events?after=${a}`,
    decode: (d) =>
      d && typeof d === "object" && "event_id" in d ? (d as E) : null,
    onEvents: (events, cursor) => void applied.push({ events, cursor }),
    onReset: (r) => void resets.push(r),
    onDelivery: (d) => void delivery.push(d),
    fetchImpl,
    sleep: async () => {},
    ...extra,
  }));
  return { feed, urls, inits, applied, delivery, resets };
}

describe("subscribing to work events", () => {
  it("applies streamed events and reconnects from the last applied cursor", async () => {
    const h = harness([
      sse([": hello\n\n", frame("c1", ev("e1", 1)), frame("c2", ev("e2", 2))]),
      // The second connection repeats e2 (at-least-once) and adds e3.
      sse([frame("c2", ev("e2", 2)), frame("c3", ev("e3", 3))]),
    ]);
    await h.feed.done;
    expect(h.urls.slice(0, 3)).toEqual([
      "/stream?after=start",
      "/stream?after=c2",
      "/stream?after=c3",
    ]);
    expect(h.applied.map((a) => [a.events[0]!.event_id, a.cursor])).toEqual([
      ["e1", "c1"],
      ["e2", "c2"],
      ["e3", "c3"],
    ]);
    expect(h.delivery).toContain("live");
    expect(h.resets).toEqual([]);
  });

  it("doesn't advance the cursor past an event that failed to apply", async () => {
    let fail = true;
    const h = harness(
      [
        sse([frame("c1", ev("e1", 1)), frame("c2", ev("e2", 2))]),
        sse([frame("c2", ev("e2", 2))]),
      ],
      {
        onEvents: (events) => {
          if (events[0]!.event_id === "e2" && fail) {
            fail = false;
            throw new Error("storage full");
          }
        },
      },
    );
    await h.feed.done;
    // e2 wasn't applied, so the next connection asks again from c1.
    expect(h.urls[1]).toBe("/stream?after=c1");
  });

  it("asks for a fresh snapshot instead of jumping to now", async () => {
    const h = harness([
      sse([frame("c1", ev("e1", 1)), "event: snapshot.required\ndata: {}\n\n"]),
    ]);
    await h.feed.done;
    expect(h.resets).toEqual(["snapshot_required"]);
    expect(h.urls).toHaveLength(1);
  });

  it("asks for a fresh snapshot on a malformed or unknown event", async () => {
    for (const bad of ["data: {not json\n\n", 'data: {"other":1}\n\n']) {
      const h = harness([sse([bad])]);
      await h.feed.done;
      expect(h.resets).toEqual(["malformed"]);
      expect(h.applied).toEqual([]);
    }
  });

  it("falls back to polling the same durable pages when there's no stream", async () => {
    const page = (body: object) => Response.json(body);
    const h = harness([
      new Response(null, { status: 404 }),
      page({
        events: [ev("e1", 1)],
        next_cursor: "c1",
        has_more: true,
        reset_required: false,
      }),
      page({
        events: [ev("e1", 1), ev("e2", 2)],
        next_cursor: "c2",
        has_more: false,
        reset_required: false,
      }),
      page({
        events: [],
        next_cursor: null,
        has_more: false,
        reset_required: true,
      }),
    ]);
    await h.feed.done;
    expect(h.urls).toEqual([
      "/stream?after=start",
      "/events?after=start",
      "/events?after=c1",
      "/events?after=c2",
    ]);
    expect(h.applied.flatMap((a) => a.events.map((e) => e.event_id))).toEqual([
      "e1",
      "e2",
    ]);
    expect(h.resets).toEqual(["snapshot_required"]);
  });

  it("reports a lost connection as stale, then offline, and keeps trying", async () => {
    const h = harness([
      new TypeError("network"),
      new TypeError("network"),
      new TypeError("network"),
      sse([frame("c1", ev("e1", 1))]),
    ]);
    await h.feed.done;
    // Two failures read as stale; the third as offline.
    expect(h.delivery).toEqual([
      "connecting",
      "stale",
      "connecting",
      "stale",
      "connecting",
      "offline",
      "connecting",
      "live",
      "stale",
      "connecting",
    ]);
    expect(h.urls.slice(0, 4).every((u) => u === "/stream?after=start")).toBe(
      true,
    );
  });

  it("reopens a stream that goes silent past the heartbeat window", async () => {
    const h = harness(
      [sse([frame("c1", ev("e1", 1))], { hold: true }), sse([])],
      { heartbeatMs: 20 },
    );
    await h.feed.done;
    expect(h.urls.slice(0, 2)).toEqual([
      "/stream?after=start",
      "/stream?after=c1",
    ]);
  });

  it("only reads, with the local-UI header, and never resends anything", async () => {
    const h = harness([
      new TypeError("network"),
      sse([frame("c1", ev("e1", 1))]),
      new Response(null, { status: 404 }),
      Response.json({
        events: [],
        next_cursor: null,
        has_more: false,
        reset_required: true,
      }),
    ]);
    await h.feed.done;
    expect(h.inits.length).toBeGreaterThan(2);
    for (const init of h.inits) {
      expect(init.method ?? "GET").toBe("GET");
      expect(init.body).toBeUndefined();
      expect(
        (init.headers as Record<string, string>)["X-Workagent-Client"],
      ).toBe("local-ui");
    }
  });
});
