/**
 * A14-R2-POLL: the polling fallback applies nothing from a page whose body
 * arrived after the subscription's scope was fenced or it was aborted: no
 * callback, cursor move, polling status, next page or reset. Uses the actual
 * subscribeWork over the actual scopedFetch.
 */
import { describe, expect, it } from "vitest";
import { fenceScope, scopedFetch } from "@/lib/client/session-scope";
import { subscribeWork } from "@/lib/client/work-stream";

const enc = (s: string) => new TextEncoder().encode(s);
const tick = () => new Promise((r) => setImmediate(r));
async function until(done: () => boolean) {
  for (let i = 0; i < 10_000 && !done(); i++) await tick();
  expect(done()).toBe(true);
}
const settle = async () => {
  for (let i = 0; i < 30; i++) await tick();
};
const ev = (i: number) => ({
  event_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  type: "artifact.changed",
  conversation_id: "cv",
  artifact_id: "A-private-artifact",
  run_id: null,
  proposal_id: null,
  assignment_id: null,
  occurred_at: `2026-10-26T00:00:0${i}Z`,
  reason_code: "material_change",
});
const page = (has_more: boolean) =>
  JSON.stringify({
    events: [ev(1)],
    next_cursor: "c1",
    has_more,
    reset_required: false,
    checked_at: "2026-10-26T00:00:09Z",
  });

/** Stream fails (enters polling); the first poll's body is held. */
function harness() {
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  let bodyPulled = false;
  // highWaterMark 0: pull runs only once res.json() actually reads.
  const body = new ReadableStream<Uint8Array>(
    {
      start(c) {
        ctl = c;
      },
      pull() {
        bodyPulled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const urls: string[] = [];
  const attempts: string[] = [];
  const raw = (async (u: string) => {
    urls.push(String(u));
    if (String(u).includes("events/stream"))
      throw new TypeError("stream dropped");
    if (urls.filter((x) => !x.includes("events/stream")).length === 1)
      return new Response(body, {
        headers: { "content-type": "application/json" },
      });
    return Response.json(JSON.parse(page(false)));
  }) as unknown as typeof fetch;
  const seen = {
    changes: 0,
    statuses: [] as string[],
    revoked: 0,
    resets: 0,
  };
  const ac = new AbortController();
  let sleeps = 0;
  const done = subscribeWork({
    base: "/api/domain",
    ws: "ws",
    cid: "cv",
    cursor: "c0",
    signal: ac.signal,
    // Counted here: after a fence scopedFetch refuses locally, so the raw
    // transport alone would hide a further attempt.
    fetch: (input, init) => {
      attempts.push(String(input));
      return scopedFetch(input, init, raw);
    },
    // Bounded: a loop that never stops on its own is ended here (and counted)
    // so a failing run terminates instead of spinning.
    sleep: async () => {
      if (++sleeps > 200) ac.abort();
      await tick();
    },
    pollMs: 1,
    onChange: () => seen.changes++,
    onStatus: (s) => seen.statuses.push(s),
    onRevoked: () => seen.revoked++,
    onReset: async () => {
      seen.resets++;
      return "c0";
    },
  });
  return {
    seen,
    urls,
    attempts,
    ac,
    done,
    bodyStarted: () => bodyPulled,
    release: (text: string) => {
      ctl.enqueue(enc(text));
      ctl.close();
    },
  };
}

describe("A14-R2-POLL: late polling bodies publish nothing", () => {
  for (const hasMore of [false, true])
    it(`a body released after the fence (has_more=${hasMore}) is not applied`, async () => {
      const h = harness();
      await until(h.bodyStarted); // res.json() is reading the held body
      const before = h.attempts.length;
      fenceScope();
      h.release(page(hasMore));
      await h.done;
      expect(h.seen.changes).toBe(0);
      expect(h.seen.statuses).not.toContain("polling");
      expect(h.seen.revoked).toBe(1);
      expect(h.seen.resets).toBe(0);
      expect(h.attempts.length).toBe(before); // no next page, no retry
    });

  it("a body released after abort is not applied and isn't a revocation", async () => {
    const h = harness();
    await until(h.bodyStarted);
    const before = h.attempts.length;
    h.ac.abort();
    h.release(page(true));
    await h.done;
    await settle();
    expect(h.seen.changes).toBe(0);
    expect(h.seen.statuses).not.toContain("polling");
    expect(h.seen.revoked).toBe(0);
    expect(h.seen.resets).toBe(0);
    expect(h.attempts.length).toBe(before);
  });

  it("same scope: the held page is applied once and polling continues", async () => {
    const h = harness();
    await until(h.bodyStarted);
    h.release(page(false));
    await until(() => h.seen.statuses.includes("polling"));
    expect(h.seen.changes).toBe(1);
    expect(h.seen.revoked).toBe(0);
    h.ac.abort();
    await h.done;
  });
});
