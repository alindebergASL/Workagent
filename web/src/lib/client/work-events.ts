/**
 * One subscription to a workspace's durable work events (Batch 2 plan, B2.3
 * and T5). Generic over the event type: the event DTO comes from the
 * generated contract once Hermes publishes it, and is decoded by the caller.
 *
 * Delivery rules from the plan:
 * - At least once: an event already applied (by ID) or older than what's
 *   shown for its aggregate (by version) is skipped, never applied twice.
 * - Apply first, then advance the cursor; reconnect from the last applied
 *   cursor, not the last byte received.
 * - `snapshot.required` (or a page with `reset_required`) means re-read the
 *   current snapshot; never silently jump to "now".
 * - Heartbeats prove the connection, not progress. Silence past the
 *   heartbeat window is a stale connection, reopened with backoff.
 * - No stream from the server: poll the same durable event pages instead.
 * Nothing here sends commands; a lost connection is never a reason to resend.
 */
import { SseError, sseParser } from "./sse";

/** How the view is being kept current: never the state of the work itself. */
export type Delivery = "connecting" | "live" | "stale" | "offline";

export type FeedKeys<T> = {
  id: (event: T) => string;
  /** The aggregate an event versions (e.g. a conversation) and its version. */
  aggregate?: (event: T) => readonly [key: string, version: number] | null;
};

export type FeedState = {
  /** Recently applied event IDs, oldest first, bounded. */
  seen: string[];
  /** Highest version applied per aggregate. */
  versions: Record<string, number>;
};

export const emptyFeed = (): FeedState => ({ seen: [], versions: {} });
const SEEN_LIMIT = 1000;

/** The events not yet applied, and the state once they are. Pure. */
export function applyEvents<T>(
  state: FeedState,
  events: T[],
  keys: FeedKeys<T>,
): { state: FeedState; fresh: T[] } {
  const seen = new Set(state.seen);
  const order = [...state.seen];
  const versions = { ...state.versions };
  const fresh: T[] = [];
  for (const e of events) {
    const id = keys.id(e);
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    const agg = keys.aggregate?.(e);
    if (agg) {
      const [key, version] = agg;
      if (key in versions && version <= versions[key]!) continue;
      versions[key] = version;
    }
    fresh.push(e);
  }
  return {
    state: { seen: order.slice(-SEEN_LIMIT), versions },
    fresh,
  };
}

export type FeedPage = {
  events: unknown[];
  next_cursor: string | null;
  has_more: boolean;
  reset_required: boolean;
};

export type FeedOptions<T> = FeedKeys<T> & {
  /** Same-origin URLs; the proxy adds credentials server-side. */
  streamUrl: (after: string | null) => string;
  pageUrl: (after: string | null) => string;
  /** The snapshot's watermark: events after it are new. */
  after: string | null;
  /** Shape check for one event; null rejects it. */
  decode: (data: unknown) => T | null;
  /** Apply new events to local state. The cursor advances only after this. */
  onEvents: (events: T[], cursor: string | null) => void | Promise<void>;
  /** Re-read the current snapshot, then subscribe again from its watermark. */
  onReset: (reason: "snapshot_required" | "malformed") => void;
  onDelivery?: (delivery: Delivery) => void;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  heartbeatMs?: number;
  pollMs?: number;
  maxBackoffMs?: number;
};

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

const headers = {
  "X-Workagent-Client": "local-ui",
} as const;

/** Statuses meaning "this server has no stream": poll the event pages. */
const NO_STREAM = new Set([404, 405, 406, 501]);

class Malformed extends Error {}

export function subscribeWork<T>(o: FeedOptions<T>): {
  stop: () => void;
  done: Promise<void>;
} {
  const control = new AbortController();
  const signal = control.signal;
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? wait;
  const heartbeatMs = o.heartbeatMs ?? 45_000;
  const pollMs = o.pollMs ?? 5_000;
  const maxBackoff = o.maxBackoffMs ?? 30_000;
  let cursor = o.after;
  let state = emptyFeed();
  let failures = 0;
  let delivery: Delivery | null = null;
  const report = (d: Delivery) => {
    if (d !== delivery && !signal.aborted) {
      delivery = d;
      o.onDelivery?.(d);
    }
  };
  const backoff = async () => {
    failures++;
    report(failures >= 3 ? "offline" : "stale");
    const base = Math.min(maxBackoff, 1000 * 2 ** (failures - 1));
    await sleep(base / 2 + Math.random() * (base / 2), signal);
  };

  async function apply(raw: unknown[], next: string | null) {
    const decoded: T[] = [];
    for (const r of raw) {
      const e = o.decode(r);
      if (!e) throw new Malformed();
      decoded.push(e);
    }
    const result = applyEvents(state, decoded, o);
    if (result.fresh.length) await o.onEvents(result.fresh, next);
    state = result.state;
    if (next) cursor = next;
  }

  /** Returns "reset" when the caller must resnapshot, else reconnects. */
  async function stream(res: Response): Promise<"reset" | "ended"> {
    const reader = res.body!.getReader();
    const parser = sseParser();
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => void reader.cancel(), heartbeatMs);
    };
    arm();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || signal.aborted) return "ended";
        arm();
        for (const out of parser.push(value)) {
          if (out.kind !== "frame") continue;
          const { frame } = out;
          if (frame.type === "snapshot.required") return "reset";
          let data: unknown;
          try {
            data = JSON.parse(frame.data);
          } catch {
            throw new Malformed();
          }
          await apply([data], frame.id || null);
          // Something real arrived: the connection has proved itself.
          failures = 0;
          report("live");
        }
        // A heartbeat or first bytes also show the view is current.
        failures = 0;
        report("live");
      }
    } finally {
      clearTimeout(watchdog);
      void reader.cancel().catch(() => {});
    }
  }

  async function poll(): Promise<"reset" | "stopped"> {
    while (!signal.aborted) {
      let page: FeedPage;
      try {
        const res = await fetchImpl(o.pageUrl(cursor), {
          headers,
          cache: "no-store",
          signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        page = (await res.json()) as FeedPage;
      } catch {
        if (signal.aborted) break;
        await backoff();
        continue;
      }
      if (page.reset_required) return "reset";
      if (!Array.isArray(page.events)) throw new Malformed();
      await apply(page.events, page.next_cursor);
      failures = 0;
      report("live");
      if (!page.has_more) await sleep(pollMs, signal);
    }
    return "stopped";
  }

  async function run() {
    while (!signal.aborted) {
      report("connecting");
      let res: Response;
      try {
        res = await fetchImpl(o.streamUrl(cursor), {
          headers: { ...headers, Accept: "text/event-stream" },
          cache: "no-store",
          signal,
        });
      } catch {
        if (signal.aborted) return;
        await backoff();
        continue;
      }
      const isStream = res.headers
        .get("content-type")
        ?.startsWith("text/event-stream");
      if (NO_STREAM.has(res.status) || (res.ok && !isStream)) {
        void res.body?.cancel().catch(() => {});
        if ((await poll()) === "reset") o.onReset("snapshot_required");
        return;
      }
      if (!res.ok || !res.body) {
        await backoff();
        continue;
      }
      let ended: "reset" | "ended";
      try {
        ended = await stream(res);
      } catch (e) {
        if (signal.aborted) return;
        if (e instanceof Malformed || e instanceof SseError) {
          o.onReset("malformed");
          return;
        }
        await backoff();
        continue;
      }
      if (ended === "reset") {
        o.onReset("snapshot_required");
        return;
      }
      if (signal.aborted) return;
      // A stream that closed (or went silent) reconnects from the cursor.
      await backoff();
    }
  }

  const done = run().catch((e) => {
    if (e instanceof Malformed && !signal.aborted) o.onReset("malformed");
  });
  return { stop: () => control.abort(), done };
}
