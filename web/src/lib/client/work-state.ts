"use client";
/**
 * Current work for one mounted conversation: the canonical snapshot, one
 * event subscription that invalidates it, and attention facts.
 *
 * - Exactly one subscription per mounted conversation; switching or
 *   unmounting aborts every fetch and read loop.
 * - One snapshot read at a time; invalidations during a read coalesce into
 *   one more read after it, so an older answer never replaces a newer one.
 * - Lost access clears every protected value held here and stops the
 *   subscription. Drafts live with the composer and are untouched.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/contract/errors";
import type { ErrorCode } from "@/lib/contract/types";
import { assertScope, captureScope, scopedFetch } from "./session-scope";

/** Snapshot reads and the stream carry this page's bound scope. */
const fenced =
  (f: typeof fetch = (...a) => fetch(...a)): typeof fetch =>
  (input, init) =>
    scopedFetch(input, init, f);
import {
  parseAttentionPage,
  parseWorkSnapshot,
  type WorkEvent,
  type WorkSnapshot,
} from "@/lib/contract/work-events";
import {
  REVOKED_STATUS,
  Revoked,
  serial,
  subscribeWork,
  workHeaders,
  type StreamStatus,
} from "./work-stream";

export interface Attention {
  readonly facts: readonly WorkEvent[];
  readonly cursor: string;
}

export interface WorkState {
  snapshot: WorkSnapshot | null;
  /** When the snapshot shown was read, by this browser. */
  readAt: string | null;
  status: StreamStatus | "loading";
  revoked: boolean;
  /** The last read failed while an earlier snapshot is still shown. */
  stale: boolean;
  error: ApiError | null;
  attention: Attention | null;
  markSeen: () => Promise<void>;
  marking: boolean;
  seenError: ApiError | null;
  refresh: () => void;
}

const transport = () =>
  new ApiError({
    code: "transport",
    status: 0,
    message: "Could not reach the local service.",
  });

async function readJson(
  doFetch: typeof fetch,
  url: string,
  signal: AbortSignal,
  init: RequestInit = {},
): Promise<unknown> {
  const scope = captureScope();
  let res: Response;
  try {
    res = await doFetch(url, {
      ...init,
      headers: { ...workHeaders(), ...(init.headers ?? {}) },
      cache: "no-store",
      signal,
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw transport();
  }
  if (REVOKED_STATUS.has(res.status)) throw new Revoked();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      code?: ErrorCode;
      message?: string;
    } | null;
    throw new ApiError({
      code: res.status >= 500 ? "transport" : (body?.code ?? "transport"),
      status: res.status,
      message: body?.message ?? "Could not confirm the request.",
    });
  }
  const data: unknown = await res.json();
  assertScope(scope); // a body that arrived after the fence is never applied
  return data;
}

export function useWorkState(
  base: string,
  ws: string | null,
  cid: string,
  options: {
    enabled?: boolean;
    /** Called once per coalesced change so other canonical reads refresh. */
    onInvalidate?: () => void;
    fetch?: typeof fetch;
    debounceMs?: number;
  } = {},
): WorkState {
  const enabled = options.enabled ?? true;
  const [snapshot, setSnapshot] = useState<WorkSnapshot | null>(null);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [status, setStatus] = useState<WorkState["status"]>("loading");
  const [revoked, setRevoked] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [attention, setAttention] = useState<Attention | null>(null);
  const [marking, setMarking] = useState(false);
  const [seenError, setSeenError] = useState<ApiError | null>(null);
  const invalidateRef = useRef<() => void>(() => {});
  const live = useRef<{ signal: AbortSignal; revoked: boolean } | null>(null);
  const seenCommands = useRef(new Map<string, string>());
  const attentionRef = useRef<Attention | null>(null);
  const opts = useRef(options);
  opts.current = options;

  useEffect(() => {
    setSnapshot(null);
    setReadAt(null);
    setAttention(null);
    attentionRef.current = null;
    setRevoked(false);
    setStale(false);
    setError(null);
    setStatus("loading");
    seenCommands.current = new Map();
    if (!ws || !enabled) return;
    const ac = new AbortController();
    const scope = { signal: ac.signal, revoked: false };
    live.current = scope;
    const doFetch = fenced(opts.current.fetch);
    const path = (p: string) =>
      `${base}/v1/workspaces/${encodeURIComponent(ws)}/${p}?${new URLSearchParams({ conversation_id: cid })}`;
    let current: WorkSnapshot | null = null;
    let reads = 0; // successful snapshot reads
    let subscribed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const revoke = () => {
      if (ac.signal.aborted) return;
      scope.revoked = true;
      current = null;
      attentionRef.current = null;
      setSnapshot(null);
      setReadAt(null);
      setAttention(null);
      setRevoked(true);
      ac.abort(); // stops the subscription and any read in flight
    };

    const readOnce = async () => {
      try {
        const raw = await readJson(doFetch, path("work-snapshot"), ac.signal);
        const next = parseWorkSnapshot(raw);
        if (ac.signal.aborted) return;
        if (next.conversation_id !== cid) throw transport();
        // Reads are serial; this guards a server answering out of order.
        if (
          current &&
          next.access_generation === current.access_generation &&
          next.work_version < current.work_version
        )
          return;
        current = next;
        reads += 1;
        failures = 0;
        setSnapshot(next);
        setReadAt(new Date().toISOString());
        setStale(false);
        setError(null);
        const att = parseAttentionPage(
          await readJson(doFetch, path("attention"), ac.signal),
        );
        if (ac.signal.aborted) return;
        // One fact per source event, however often it was delivered.
        const ids = new Set<string>();
        const facts = att.facts.filter(
          (f) =>
            f.conversation_id === cid &&
            !ids.has(f.event_id) &&
            ids.add(f.event_id),
        );
        const value = Object.freeze({
          facts: Object.freeze(facts),
          cursor: att.next_cursor,
        });
        attentionRef.current = value;
        setAttention(value);
      } catch (e) {
        if (ac.signal.aborted) return;
        if (e instanceof Revoked) return revoke();
        failures += 1;
        const err = e instanceof ApiError ? e : transport();
        if (current) setStale(true);
        else setError(err);
        // Retry with backoff, before and after subscribing: the stream has
        // already moved past the event that asked for this read, so nothing
        // else would bring the view back up to date.
        if (timer) clearTimeout(timer);
        timer = setTimeout(
          () => void invalidate(),
          Math.min(15000, 1000 * 2 ** Math.min(failures, 4)),
        );
      }
    };

    const read = serial(readOnce, () => ac.signal.aborted);
    const invalidate = (): Promise<void> =>
      read().then(() => {
        if (current && !subscribed && !ac.signal.aborted) {
          subscribed = true;
          void subscribeWork({
            base,
            ws,
            cid,
            cursor: current.snapshot_cursor,
            signal: ac.signal,
            fetch: doFetch,
            onStatus: (s) => {
              if (!ac.signal.aborted) setStatus(s);
            },
            onRevoked: revoke,
            onChange: () => {
              if (timer) clearTimeout(timer);
              timer = setTimeout(() => {
                opts.current.onInvalidate?.();
                void invalidate();
              }, opts.current.debounceMs ?? 120);
            },
            onReset: async () => {
              // Resume only from a snapshot read after the reset.
              const before = reads;
              await invalidate();
              if (scope.revoked) throw new Revoked();
              if (!current || reads === before) throw transport();
              opts.current.onInvalidate?.();
              return current.snapshot_cursor;
            },
          }).catch(() => {});
        }
      });
    invalidateRef.current = () => void invalidate();
    void invalidate();
    return () => {
      ac.abort();
      if (timer) clearTimeout(timer);
      invalidateRef.current = () => {};
      if (live.current === scope) live.current = null;
    };
  }, [base, ws, cid, enabled]);

  const markSeen = useCallback(async () => {
    const scope = live.current;
    const att = attentionRef.current;
    if (!ws || !scope || scope.revoked || !att || marking) return;
    // The same cursor always replays the same command: retrying is safe.
    let commandId = seenCommands.current.get(att.cursor);
    if (!commandId) {
      commandId = crypto.randomUUID();
      seenCommands.current.set(att.cursor, commandId);
    }
    setMarking(true);
    setSeenError(null);
    try {
      await readJson(
        fenced(opts.current.fetch),
        `${base}/v1/workspaces/${encodeURIComponent(ws)}/attention/seen`,
        scope.signal,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schema_version: "workagent/v1",
            request_id: crypto.randomUUID(),
            command_id: commandId,
            conversation_id: cid,
            cursor: att.cursor,
          }),
        },
      );
      invalidateRef.current();
    } catch (e) {
      if (scope.signal.aborted) return;
      if (e instanceof Revoked) {
        invalidateRef.current();
        return;
      }
      setSeenError(e instanceof ApiError ? e : transport());
    } finally {
      if (!scope.signal.aborted) setMarking(false);
    }
  }, [base, ws, cid, marking]);

  const refresh = useCallback(() => invalidateRef.current(), []);

  return {
    snapshot,
    readAt,
    status,
    revoked,
    stale,
    error,
    attention,
    markSeen,
    marking,
    seenError,
    refresh,
  };
}
