"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/contract/errors";
import { currentFor, nextEvidence, noEvidence } from "./resource-freshness";

export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reconnecting: boolean;
  /**
   * The data is from the newest read, which succeeded: false while a
   * replacement read is pending and after one failed (see resource-freshness).
   */
  current: boolean;
  observedAt: string | null;
  refresh: () => Promise<T | null>;
  set: (next: T) => void;
}

/** One cancellable read scheduler per resource; mutations never originate here. */
export function useResource<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: {
    /** Re-read interval; may depend on what was last read. */
    pollMs?: number | ((data: T | null) => number);
    shouldPoll?: (data: T | null) => boolean;
  } = {},
): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(key));
  const [reconnecting, setReconnecting] = useState(false);
  const [evidence, setEvidence] = useState(noEvidence);
  const [observedAt, setObservedAt] = useState<string | null>(null);
  const failures = useRef(0);
  const terminal = useRef(false);
  const generation = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const dataRef = useRef<T | null>(null);
  const refreshRef = useRef<() => Promise<T | null>>(async () => null);
  const scheduleRef = useRef<() => void>(() => {});

  const load = useCallback(
    async (signal: AbortSignal): Promise<T | null> => {
      if (!key) return null;
      const requestGeneration = ++generation.current;
      setEvidence((p) => nextEvidence(p, key, { kind: "start" }));
      const superseded = () =>
        signal.aborted || requestGeneration !== generation.current;
      try {
        const next = await fetcherRef.current(signal);
        const late = superseded();
        // A superseded answer leaves freshness to the newer read.
        setEvidence((p) =>
          nextEvidence(p, key, { kind: "success", superseded: late }),
        );
        if (late) return null;
        dataRef.current = next;
        failures.current = 0;
        terminal.current = false;
        setData(next);
        setError(null);
        setReconnecting(false);
        setObservedAt(new Date().toISOString());
        setLoading(false);
        return next;
      } catch (e) {
        const late = superseded();
        setEvidence((p) =>
          nextEvidence(p, key, { kind: "failure", superseded: late }),
        );
        if (late) return null;
        const err =
          e instanceof ApiError
            ? e
            : new ApiError({
                code: "transport",
                status: 0,
                message: "Request failed.",
              });
        failures.current += 1;
        terminal.current =
          err.code === "not_found_or_not_authorized" ||
          err.code === "unauthenticated";
        if (terminal.current) {
          dataRef.current = null;
          setData(null);
          setError(err);
          setReconnecting(false);
        } else if (dataRef.current) {
          setReconnecting(true);
        } else {
          setError(err);
        }
        setLoading(false);
        return null;
      }
    },
    [key],
  );

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let inFlight: Promise<T | null> | null = null;
    dataRef.current = null;
    setData(null);
    setError(null);
    setObservedAt(null);
    setEvidence((p) => nextEvidence(p, key, { kind: "reset" }));
    failures.current = 0;
    terminal.current = false;
    setLoading(Boolean(key));
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (stopped || !key || inFlight || terminal.current) return;
      const poll = optionsRef.current.pollMs;
      const base =
        typeof poll === "function" ? poll(dataRef.current) : (poll ?? 0);
      const shouldPoll =
        optionsRef.current.shouldPoll?.(dataRef.current) ?? base > 0;
      if (failures.current > 0) {
        timer = setTimeout(
          () => void tick(),
          Math.min(15000, 1500 * 2 ** Math.min(failures.current, 4)),
        );
      } else if (shouldPoll && base > 0) {
        timer = setTimeout(() => void tick(), base);
      }
    };
    const start = (): Promise<T | null> => {
      if (timer) clearTimeout(timer);
      timer = null;
      const read: Promise<T | null> = load(controller.signal).finally(() => {
        if (inFlight !== read) return;
        inFlight = null;
        schedule();
      });
      inFlight = read;
      return read;
    };
    const tick = (): Promise<T | null> => {
      if (stopped || !key) return Promise.resolve(null);
      return inFlight ?? start();
    };
    // A refresh after a mutation starts a new read at once. A read already
    // under way was sent before the mutation, so its answer is dropped (each
    // read supersedes the ones before it) rather than shown over the new state.
    refreshRef.current = async () => {
      if (stopped || !key) return null;
      return start();
    };
    scheduleRef.current = schedule;
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refreshRef.current();
    };
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    if (key) void tick();
    return () => {
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
      stopped = true;
      generation.current += 1;
      controller.abort();
      if (timer) clearTimeout(timer);
      refreshRef.current = async () => null;
      scheduleRef.current = () => {};
    };
  }, [key, load]);

  // Stable for dependent effects; the ref follows the current key's scheduler
  // (and becomes a no-op on cleanup), without capturing a stale fetcher.
  const refresh = useCallback(() => refreshRef.current(), []);

  return {
    data,
    error,
    loading,
    reconnecting,
    // Keyed: evidence read for another key is never current here.
    current: currentFor(evidence, key),
    observedAt,
    refresh,
    set: (next) => {
      generation.current += 1; // An older in-flight response cannot replace a mutation result.
      dataRef.current = next;
      terminal.current = false;
      failures.current = 0;
      setData(next);
      setError(null);
      setReconnecting(false);
      setEvidence((p) => nextEvidence(p, key, { kind: "set" }));
      scheduleRef.current();
    },
  };
}
