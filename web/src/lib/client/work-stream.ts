/**
 * One subscription to a conversation's work events.
 *
 * Streams over an authenticated same-origin fetch (the server proxy adds the
 * credential; nothing secret is in the URL). Events only say "something
 * changed": the caller re-reads canonical state, it never patches it. The
 * cursor is opaque and only ever replaced by the exact id the server sent.
 * On a network failure it polls the same page model, then retries the
 * stream; on an explicit reset it re-reads the snapshot and resumes from that
 * snapshot's cursor; on lost access it stops.
 */
import { DEFAULT_MAX_FRAME, SseOverflow, SseParser } from "./sse";
import { boundScope, captureScope, scopedFetch } from "./session-scope";
import {
  ContractError,
  parseEventPage,
  parseWorkEvent,
  type WorkEvent,
} from "@/lib/contract/work-events";

export type StreamStatus = "connecting" | "live" | "polling" | "reconnecting";

/** Access to this conversation is gone (or the read was refused). */
export class Revoked extends Error {
  constructor() {
    super("Access to this conversation changed.");
    this.name = "Revoked";
  }
}

export const REVOKED_STATUS = new Set([401, 403, 404]);

/** Bounded memory of applied event ids: replays don't count twice. */
export class SeenIds {
  private readonly order: string[] = [];
  private readonly set = new Set<string>();
  constructor(private readonly max = 512) {}
  /** True the first time an id is seen. */
  add(id: string): boolean {
    if (this.set.has(id)) return false;
    this.set.add(id);
    this.order.push(id);
    if (this.order.length > this.max) this.set.delete(this.order.shift()!);
    return true;
  }
}

/**
 * One read at a time. Calls made during a read coalesce into exactly one more
 * read after it, and their promise settles after that read, so a caller
 * always waits for a read that started after it asked.
 */
export function serial(
  read: () => Promise<void>,
  stopped: () => boolean,
): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  return () => {
    if (stopped()) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await read();
      } while (again && !stopped());
    })().finally(() => {
      running = null;
    });
    return running;
  };
}

export interface SubscribeOptions {
  base: string;
  ws: string;
  cid: string;
  /** Snapshot cursor to resume after. Opaque. */
  cursor: string;
  signal: AbortSignal;
  /** New, in-scope events. The caller invalidates canonical reads. */
  onChange: (events: WorkEvent[]) => void;
  /** Re-read the snapshot; resolve its cursor, or throw Revoked. */
  onReset: () => Promise<string>;
  onRevoked: () => void;
  onStatus: (status: StreamStatus) => void;
  fetch?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  maxFrame?: number;
  pollMs?: number;
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

export const workHeaders = () => ({
  "X-Workagent-Client": "local-ui",
  "X-Schema-Version": "workagent/v1",
  "X-Request-Id": crypto.randomUUID(),
});

const CURSOR = /^[\x21-\x7e]{1,128}$/;

class Transport extends Error {}
class NeedsReset extends Error {}

export async function subscribeWork(o: SubscribeOptions): Promise<void> {
  const doFetch: typeof fetch =
    o.fetch ?? ((input, init) => scopedFetch(input, init));
  const sleep = o.sleep ?? defaultSleep;
  const pollMs = o.pollMs ?? 2000;
  const seen = new SeenIds();
  let cursor = o.cursor;
  let failures = 0;
  const q = (path: string, extra: Record<string, string> = {}) =>
    `${o.base}/v1/workspaces/${encodeURIComponent(o.ws)}/${path}?${new URLSearchParams(
      { conversation_id: o.cid, after: cursor, ...extra },
    )}`;

  // Frames are applied only while the page is bound to the scope this
  // subscription began in; checked synchronously, not left to unmounting.
  const scope = captureScope();
  const fenced = () => !scope || boundScope() !== scope;

  /** Applies events in order; advances the cursor only by server ids. */
  const apply = (items: { event: WorkEvent; id: string }[]) => {
    if (fenced()) throw new Revoked();
    const fresh: WorkEvent[] = [];
    for (const { event, id } of items) {
      if (event.conversation_id !== o.cid) continue; // not this scope
      cursor = id;
      if (seen.add(event.event_id)) fresh.push(event);
    }
    if (fresh.length) o.onChange(fresh);
  };

  const reset = async () => {
    if (fenced()) throw new Revoked();
    o.onStatus("connecting");
    cursor = await o.onReset();
    if (fenced()) throw new Revoked();
  };

  /** One stream connection. Returns when it should reconnect. */
  const stream = async () => {
    const res = await doFetch(q("events/stream"), {
      headers: { ...workHeaders(), Accept: "text/event-stream" },
      cache: "no-store",
      signal: o.signal,
    }).catch((e: unknown) => {
      if (o.signal.aborted) throw e;
      throw new Transport();
    });
    if (REVOKED_STATUS.has(res.status)) throw new Revoked();
    if (
      !res.ok ||
      !res.body ||
      !res.headers.get("content-type")?.includes("text/event-stream")
    ) {
      await res.body?.cancel().catch(() => {});
      throw new Transport();
    }
    const reader = res.body.getReader();
    const parser = new SseParser(o.maxFrame ?? DEFAULT_MAX_FRAME);
    o.onStatus("live");
    failures = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        const batch: { event: WorkEvent; id: string }[] = [];
        for (const frame of parser.push(value)) {
          if (frame.event === "snapshot.required") {
            apply(batch);
            throw new NeedsReset();
          }
          if (frame.event !== "work.changed") continue;
          if (!frame.id || !CURSOR.test(frame.id)) throw new NeedsReset();
          let event: WorkEvent;
          try {
            event = parseWorkEvent(JSON.parse(frame.data));
          } catch {
            throw new NeedsReset();
          }
          batch.push({ event, id: frame.id });
        }
        apply(batch);
      }
    } catch (e) {
      if (e instanceof SseOverflow) throw new Transport();
      if (e instanceof NeedsReset || e instanceof Revoked || o.signal.aborted)
        throw e;
      throw new Transport(); // a dropped body read
    } finally {
      reader.cancel().catch(() => {});
    }
  };

  /** One page walk of the polling fallback. */
  const poll = async () => {
    for (let pages = 0; pages < 10; pages++) {
      const res = await doFetch(q("events", { limit: "100" }), {
        headers: workHeaders(),
        cache: "no-store",
        signal: o.signal,
      }).catch((e: unknown) => {
        if (o.signal.aborted) throw e;
        throw new Transport();
      });
      if (REVOKED_STATUS.has(res.status)) throw new Revoked();
      if (!res.ok) throw new Transport();
      let body: unknown;
      try {
        body = await res.json();
      } catch (e) {
        if (o.signal.aborted) throw e;
        throw new Transport();
      }
      // The body may arrive after an abort or after the page was fenced:
      // then nothing from it is parsed, filtered, applied or continued.
      if (o.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (fenced()) throw new Revoked();
      let page;
      try {
        page = parseEventPage(body);
      } catch (e) {
        throw e instanceof ContractError ? new NeedsReset() : new Transport();
      }
      if (page.reset_required) throw new NeedsReset();
      // A page's events carry no per-event cursor: apply them, then move to
      // the page's own next_cursor.
      const fresh = page.events.filter(
        (e) => e.conversation_id === o.cid && seen.add(e.event_id),
      );
      cursor = page.next_cursor;
      if (fresh.length) o.onChange(fresh);
      if (!page.has_more) return;
    }
  };

  while (!o.signal.aborted) {
    try {
      await stream();
      // Clean end (server closed): reconnect, re-authenticated by the proxy.
      await sleep(250, o.signal);
    } catch (e) {
      if (o.signal.aborted) return;
      try {
        if (e instanceof Revoked) throw e;
        if (e instanceof NeedsReset) {
          await reset();
          continue;
        }
        // Network outage or broken stream: poll the same page model a few
        // times before trying the stream again.
        failures += 1;
        const rounds = Math.min(2 ** failures, 8);
        for (let i = 0; i < rounds && !o.signal.aborted; i++) {
          try {
            await poll();
            o.onStatus("polling");
            await sleep(pollMs, o.signal);
          } catch (pe) {
            if (pe instanceof Revoked || pe instanceof NeedsReset) throw pe;
            if (o.signal.aborted) return;
            o.onStatus("reconnecting");
            await sleep(
              Math.min(15000, 1000 * 2 ** Math.min(failures, 4)),
              o.signal,
            );
            break;
          }
        }
      } catch (fatal) {
        if (o.signal.aborted) return;
        if (fatal instanceof Revoked) {
          o.onRevoked();
          return;
        }
        if (fatal instanceof NeedsReset) {
          try {
            await reset();
          } catch (re) {
            if (re instanceof Revoked) {
              o.onRevoked();
              return;
            }
            o.onStatus("reconnecting");
            await sleep(
              Math.min(15000, 1000 * 2 ** Math.min(++failures, 4)),
              o.signal,
            );
          }
          continue;
        }
        o.onStatus("reconnecting");
        await sleep(
          Math.min(15000, 1000 * 2 ** Math.min(++failures, 4)),
          o.signal,
        );
      }
    }
  }
}
