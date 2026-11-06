import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SseOverflow, SseParser } from "@/lib/client/sse";
import { SeenIds, serial, subscribeWork } from "@/lib/client/work-stream";
import {
  ContractError,
  parseEventPage,
  parseWorkSnapshot,
  type WorkSnapshot,
} from "@/lib/contract/work-events";
import { executionView, responsibilityView } from "@/lib/work-view";
import { CurrentWork } from "@/components/CurrentWork";
import type { WorkState } from "@/lib/client/work-state";

// Same frame shape as backend work_event_api.frame / work_event_fixtures.
const CID = "fixture-conversation";
const ev = (i: number, cid = CID) => ({
  event_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  type: "artifact.changed",
  conversation_id: cid,
  artifact_id: "fixture-artifact",
  run_id: null,
  proposal_id: null,
  assignment_id: null,
  occurred_at: `2026-10-26T00:00:0${i}Z`,
  reason_code: "material_change",
});
const frame = (name: string, data: unknown, id?: string) =>
  (id ? `id: ${id}\n` : "") +
  `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
const enc = (s: string) => new TextEncoder().encode(s);
const chunks = (bytes: Uint8Array, size: number) => {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size)
    out.push(bytes.slice(i, i + size));
  return out;
};

describe("SSE parser", () => {
  const wire =
    ": heartbeat\n\n" +
    frame("work.changed", { ...ev(1), note: "café ☕ 𝄞" }, "tok-A") +
    frame("work.changed", ev(2), "tok-B");

  it.each([1, 2, 3, 5, 64, 1024])(
    "same frames for any chunking (size %i), incl. split multibyte",
    (size) => {
      const p = new SseParser();
      const frames = chunks(enc(wire), size).flatMap((c) => p.push(c));
      expect(frames.map((f) => f.id)).toEqual(["tok-A", "tok-B"]);
      expect(JSON.parse(frames[0]!.data).note).toBe("café ☕ 𝄞");
      expect(frames.every((f) => f.event === "work.changed")).toBe(true);
    },
  );

  it("handles CRLF split across chunks, multi-line data, comments", () => {
    const p = new SseParser();
    const out = [
      ...p.push(enc("id: x\r")),
      ...p.push(enc("\nevent: e\r\ndata: a\r\ndata: b\r\n: c\r\n\r")),
      ...p.push(enc("\n")),
    ];
    expect(out).toEqual([{ event: "e", data: "a\nb", id: "x" }]);
  });

  it("does not inherit an id from an earlier frame", () => {
    const p = new SseParser();
    const out = p.push(enc("id: one\ndata: 1\n\ndata: 2\n\n"));
    expect(out.map((f) => f.id)).toEqual(["one", null]);
  });

  it("heartbeat-only input yields nothing; unterminated tail is dropped", () => {
    const p = new SseParser();
    expect(p.push(enc(": heartbeat\n\n: heartbeat\n\n"))).toEqual([]);
    expect(p.push(enc("data: partial"))).toEqual([]);
    expect(p.end()).toEqual([]);
  });

  it("caps an oversized frame, terminated or not (negative control)", () => {
    const small = new SseParser(100);
    expect(() => small.push(enc(`data: ${"x".repeat(200)}`))).toThrow(
      SseOverflow,
    );
    const lines = new SseParser(100);
    expect(() =>
      lines.push(enc(`data: ${"y".repeat(60)}\ndata: ${"y".repeat(60)}\n`)),
    ).toThrow(SseOverflow);
    // Under the cap passes.
    expect(new SseParser(100).push(enc("data: ok\n\n"))).toHaveLength(1);
  });
});

describe("contract adapter", () => {
  const snap = (over: Partial<Record<string, unknown>> = {}) => ({
    schema_version: "workagent/work-v1",
    conversation_id: CID,
    work_version: 3,
    access_generation: 1,
    checked_at: "2026-10-26T10:00:00Z",
    snapshot_cursor: "opaque.Cursor-1",
    execution: { state: "queued", admission: "admitted", worker_live: false },
    responsibility: [],
    artifacts: [],
    pending_proposals: [],
    ...over,
  });

  it("returns a frozen copy without unknown fields", () => {
    const raw = { ...snap(), secret_body: "nope" };
    const s = parseWorkSnapshot(raw);
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.execution)).toBe(true);
    expect("secret_body" in s).toBe(false);
    (raw.execution as { state: string }).state = "running";
    expect(s.execution.state).toBe("queued"); // not re-read
  });

  it("rejects wrong schema, unknown state, numeric cursor type", () => {
    expect(() => parseWorkSnapshot(snap({ schema_version: "x" }))).toThrow(
      ContractError,
    );
    expect(() =>
      parseWorkSnapshot(snap({ execution: { state: "done" } })),
    ).toThrow(ContractError);
    expect(() => parseWorkSnapshot(snap({ snapshot_cursor: 42 }))).toThrow(
      ContractError,
    );
    expect(() =>
      parseEventPage({
        events: [{ ...ev(1), type: "secret.leak" }],
        next_cursor: "c",
        has_more: false,
        checked_at: "2026-10-26T00:00:00Z",
      }),
    ).toThrow(ContractError);
  });
});

describe("serial refresh", () => {
  it("runs one read at a time and coalesces calls into one more read", async () => {
    let active = 0;
    let max = 0;
    let count = 0;
    const gates: (() => void)[] = [];
    const run = serial(
      async () => {
        active++;
        count++;
        max = Math.max(max, active);
        await new Promise<void>((r) => gates.push(r));
        active--;
      },
      () => false,
    );
    const a = run();
    const b = run();
    const c = run();
    gates.shift()!();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    gates.shift()!();
    await Promise.all([a, b, c]);
    expect(count).toBe(2);
    expect(max).toBe(1);
  });
});

describe("SeenIds", () => {
  it("dedupes and stays bounded", () => {
    const s = new SeenIds(2);
    expect(s.add("a")).toBe(true);
    expect(s.add("a")).toBe(false);
    s.add("b");
    s.add("c");
    expect(s.add("a")).toBe(true); // evicted
  });
});

// ---- subscription driver with a scripted fetch ----

type Step =
  | { kind: "stream"; body: string[]; status?: number }
  | { kind: "json"; status: number; body: unknown }
  | { kind: "throw" };

function scripted(steps: Step[]) {
  const urls: string[] = [];
  const inits: RequestInit[] = [];
  const f = (async (url: string, init: RequestInit) => {
    urls.push(url);
    inits.push(init);
    const step = steps.shift();
    if (!step) {
      // Park until aborted.
      return new Promise((_, reject) =>
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      );
    }
    if (step.kind === "throw") throw new TypeError("network");
    if (step.kind === "json")
      return new Response(JSON.stringify(step.body), {
        status: step.status,
        headers: { "content-type": "application/json" },
      });
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const part of step.body) c.enqueue(enc(part));
        c.close();
      },
    });
    return new Response(body, {
      status: step.status ?? 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as unknown as typeof fetch;
  return { f, urls, inits };
}

async function drive(
  steps: Step[],
  opts: { reset?: () => Promise<string>; until: (s: Seen) => boolean },
) {
  const { f, urls, inits } = scripted(steps);
  const ac = new AbortController();
  const seen: Seen = { changes: [], statuses: [], revoked: 0, resets: 0 };
  const done = subscribeWork({
    base: "/api/domain",
    ws: "ws1",
    cid: CID,
    cursor: "snap-cursor",
    signal: ac.signal,
    fetch: f,
    sleep: async () => {
      if (opts.until(seen)) ac.abort();
      await new Promise((r) => setTimeout(r, 0));
    },
    onChange: (e) => seen.changes.push(e.map((x) => x.event_id)),
    onStatus: (s) => seen.statuses.push(s),
    onRevoked: () => {
      seen.revoked++;
    },
    onReset: async () => {
      seen.resets++;
      return opts.reset ? opts.reset() : "after-reset";
    },
  });
  for (let i = 0; i < 200 && !ac.signal.aborted && !seen.revoked; i++)
    await new Promise((r) => setTimeout(r, 0));
  ac.abort();
  await done;
  return { seen, urls, inits };
}
interface Seen {
  changes: string[][];
  statuses: string[];
  revoked: number;
  resets: number;
}

describe("subscribeWork", () => {
  const A = frame("work.changed", ev(1), "tok-A");
  const B = frame("work.changed", ev(2), "tok-B");

  it("applies each event once across duplicate/replayed delivery and resumes from the exact server id", async () => {
    const { seen, urls, inits } = await drive(
      [
        { kind: "stream", body: [A.slice(0, 7), A.slice(7) + B, B] },
        { kind: "stream", body: [A, ": heartbeat\n\n"] },
        { kind: "stream", body: [] },
      ],
      { until: (s) => s.statuses.filter((x) => x === "live").length >= 3 },
    );
    expect(seen.changes.flat()).toEqual([ev(1).event_id, ev(2).event_id]);
    const first = new URL(urls[0]!, "http://x");
    expect(first.pathname).toBe("/api/domain/v1/workspaces/ws1/events/stream");
    expect(first.searchParams.get("after")).toBe("snap-cursor");
    const after = (i: number) =>
      new URL(urls[i]!, "http://x").searchParams.get("after");
    expect(after(1)).toBe("tok-B");
    // The exact last id received, even if it sorts lower: no comparison.
    expect(after(2)).toBe("tok-A");
    for (const u of urls) expect(u).not.toMatch(/token|bearer|auth/i);
    const h = inits[0]!.headers as Record<string, string>;
    expect(h["X-Workagent-Client"]).toBe("local-ui");
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain(
      "authorization",
    );
  });

  it("ignores events for another conversation (scope negative control)", async () => {
    const other = frame("work.changed", ev(3, "other-conv"), "tok-X");
    const { seen, urls } = await drive(
      [
        { kind: "stream", body: [other, A] },
        { kind: "stream", body: [] },
      ],
      { until: (s) => s.statuses.filter((x) => x === "live").length >= 2 },
    );
    expect(seen.changes.flat()).toEqual([ev(1).event_id]);
    expect(new URL(urls[1]!, "http://x").searchParams.get("after")).toBe(
      "tok-A",
    );
  });

  it("snapshot.required re-reads the snapshot and resumes from its cursor", async () => {
    const { seen, urls } = await drive(
      [
        {
          kind: "stream",
          body: [A, frame("snapshot.required", { reason: "cursor_reset" })],
        },
        { kind: "stream", body: [] },
      ],
      {
        reset: async () => "fresh-snap",
        until: (s) =>
          s.resets >= 1 && s.statuses.filter((x) => x === "live").length >= 2,
      },
    );
    expect(seen.resets).toBe(1);
    expect(new URL(urls[1]!, "http://x").searchParams.get("after")).toBe(
      "fresh-snap",
    );
  });

  it("a malformed event forces a reset instead of inventing state", async () => {
    const bad = frame("work.changed", { ...ev(1), type: "made.up" }, "tok-Z");
    const { seen } = await drive([{ kind: "stream", body: [bad] }], {
      until: (s) => s.resets >= 1,
    });
    expect(seen.changes).toEqual([]);
    expect(seen.resets).toBe(1);
  });

  it("falls back to polling on a network outage, same page model", async () => {
    const { seen, urls } = await drive(
      [
        { kind: "throw" },
        {
          kind: "json",
          status: 200,
          body: {
            events: [ev(1), ev(1)],
            next_cursor: "page-next",
            has_more: false,
            checked_at: "2026-10-26T00:00:09Z",
          },
        },
      ],
      { until: (s) => s.statuses.includes("polling") },
    );
    expect(new URL(urls[1]!, "http://x").pathname).toBe(
      "/api/domain/v1/workspaces/ws1/events",
    );
    expect(seen.changes.flat()).toEqual([ev(1).event_id]);
    expect(seen.statuses).toContain("polling");
  });

  it("an oversized frame drops the connection and reconnects from the last applied cursor", async () => {
    const huge = `data: ${"x".repeat(70 * 1024)}\n\n`;
    const { urls } = await drive(
      [
        { kind: "stream", body: [A, huge] },
        { kind: "json", status: 503, body: {} },
        { kind: "stream", body: [] },
      ],
      { until: (s) => s.statuses.filter((x) => x === "live").length >= 2 },
    );
    const after = urls.map((u) =>
      new URL(u, "http://x").searchParams.get("after"),
    );
    expect(after.slice(1).every((a) => a === "tok-A")).toBe(true);
  });

  it("lost access stops the subscription (no retry loop)", async () => {
    const { seen, urls } = await drive(
      [
        {
          kind: "json",
          status: 404,
          body: { code: "not_found_or_not_authorized" },
        },
      ],
      { until: () => false },
    );
    expect(seen.revoked).toBe(1);
    expect(urls).toHaveLength(1);
  });

  it("access_changed with a refused snapshot re-read revokes", async () => {
    const { Revoked } = await import("@/lib/client/work-stream");
    const { seen } = await drive(
      [
        {
          kind: "stream",
          body: [frame("snapshot.required", { reason: "access_changed" })],
        },
      ],
      {
        reset: async () => {
          throw new Revoked();
        },
        until: () => false,
      },
    );
    expect(seen.revoked).toBe(1);
  });
});

// ---- view ----

const execution = (over: Partial<WorkSnapshot["execution"]>) =>
  parseWorkSnapshot({
    schema_version: "workagent/work-v1",
    conversation_id: CID,
    work_version: 1,
    access_generation: 1,
    checked_at: "2026-10-26T10:00:00Z",
    snapshot_cursor: "c",
    execution: { state: "idle", ...over },
    responsibility: [],
    artifacts: [],
    pending_proposals: [],
  }).execution;

describe("current-state view", () => {
  it("queued admission is not an active worker", () => {
    const v = executionView(
      execution({ state: "queued", admission: "admitted" }),
    )!;
    expect(v.label).toBe("Queued");
    expect(v.text).toMatch(/Nothing has started/);
  });
  it("running without an observed live worker is not shown as working", () => {
    expect(executionView(execution({ state: "running" }))!.label).toBe(
      "Running, not confirmed",
    );
    expect(
      executionView(execution({ state: "running", worker_live: true }))!.label,
    ).toBe("Working");
  });
  it("unknown outcome is prominent and says not to retry blindly", () => {
    const v = executionView(execution({ state: "unknown" }))!;
    expect(v.unresolved).toBe(true);
    expect(v.text).toMatch(/won’t be retried/);
  });
  it("idle shows nothing; no percentages anywhere", () => {
    expect(executionView(execution({}))).toBeNull();
    for (const state of [
      "queued",
      "running",
      "awaiting_provider",
      "stale",
    ] as const)
      expect(executionView(execution({ state }))!.text).not.toMatch(/%/);
  });
  it("responsibility keeps earlier check-in separate from current next action", () => {
    const v = responsibilityView({
      assignment_id: "a1",
      state: "waiting_event",
      next_action: {
        kind: "await_event",
        description: "Wait for the vendor reply",
      },
      next_check_in_at: "2026-10-27T09:00:00Z",
      historical_observation: {
        text: "All good yesterday",
        observed_at: "2026-10-25T09:00:00Z",
      },
      review_required: false,
    });
    expect(v.next).toBe("Wait for the vendor reply");
    expect(v.earlier).toEqual({
      text: "All good yesterday",
      at: "2026-10-25T09:00:00Z",
    });
    expect(v.label).toBe("Waiting for a change");
  });
});

describe("CurrentWork render", () => {
  const state = (over: Partial<WorkState>): WorkState => ({
    snapshot: null,
    readAt: null,
    status: "live",
    revoked: false,
    stale: false,
    error: null,
    attention: null,
    markSeen: async () => {},
    marking: false,
    seenError: null,
    refresh: () => {},
    ...over,
  });
  const snapshot = parseWorkSnapshot({
    schema_version: "workagent/work-v1",
    conversation_id: CID,
    work_version: 4,
    access_generation: 1,
    checked_at: "2026-10-26T10:00:00Z",
    snapshot_cursor: "c",
    execution: { state: "unknown", run_id: "run-1" },
    responsibility: [
      {
        assignment_id: "a1",
        state: "active",
        next_action: {
          kind: "continue_work",
          description: "Draft the summary",
        },
        next_check_in_at: null,
        historical_observation: {
          text: "Earlier it was blocked",
          observed_at: "2026-10-25T08:00:00Z",
        },
        review_required: true,
      },
    ],
    artifacts: [
      {
        id: "art-1",
        title: "Budget",
        kind: "table",
        current_revision_id: "rev-7",
        body_hash: "h",
      },
    ],
    pending_proposals: [
      {
        proposal_id: "p-1",
        artifact_id: "art-1",
        base_revision_id: "rev-6",
        base_work_version: 3,
        created_at: "2026-10-26T09:00:00Z",
        fresh: false,
        is_latest: true,
        removed_content_count: 2,
      },
    ],
  });

  it("shows current facts, labelled earlier check-in, review link and exact revision in details", () => {
    const html = renderToStaticMarkup(
      createElement(CurrentWork, {
        work: state({
          snapshot,
          attention: {
            facts: [
              parseEventPage({
                events: [ev(1)],
                next_cursor: "n",
                has_more: false,
                checked_at: "2026-10-26T00:00:00Z",
              }).events[0]!,
            ],
            cursor: "n",
          },
        }),
        ws: "ws1",
        cid: CID,
      }),
    );
    expect(html).toContain("Outcome unknown");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Next: Draft the summary");
    expect(html).toContain("Earlier check-in (");
    expect(html).toContain("Earlier it was blocked");
    expect(html).toContain("Needs your review");
    expect(html).toContain("#proposal-p-1");
    expect(html).toContain("Based on an earlier version · removes 2 items");
    expect(html).toContain("Current version rev-7");
    expect(html).toContain("Mark as seen");
    expect(html).not.toMatch(/\d+%/);
    // Machinery stays in Details.
    expect(html.indexOf("run-1")).toBeGreaterThan(html.indexOf("<details"));
  });

  it("revoked hides every earlier fact (negative control)", () => {
    const html = renderToStaticMarkup(
      createElement(CurrentWork, {
        work: state({ revoked: true, snapshot }),
        ws: "ws1",
        cid: CID,
      }),
    );
    expect(html).toContain("access to this conversation changed");
    expect(html).not.toContain("Budget");
    expect(html).not.toContain("Draft the summary");
  });
});
