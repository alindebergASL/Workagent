"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/contract/errors";

export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reconnecting: boolean;
  observedAt: string | null;
  refresh: () => Promise<T | null>;
  set: (next: T) => void;
}

/** One cancellable read scheduler per resource; mutations never originate here. */
export function useResource<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: { pollMs?: number; shouldPoll?: (data: T | null) => boolean } = {},
): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(key));
  const [reconnecting, setReconnecting] = useState(false);
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
      try {
        const next = await fetcherRef.current(signal);
        if (signal.aborted || requestGeneration !== generation.current)
          return null;
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
        if (signal.aborted || requestGeneration !== generation.current)
          return null;
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
    failures.current = 0;
    terminal.current = false;
    setLoading(Boolean(key));
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (stopped || !key || inFlight || terminal.current) return;
      const base = optionsRef.current.pollMs ?? 0;
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
    const tick = (): Promise<T | null> => {
      if (stopped || !key) return Promise.resolve(null);
      if (inFlight) return inFlight;
      if (timer) clearTimeout(timer);
      timer = null;
      inFlight = load(controller.signal).finally(() => {
        inFlight = null;
        schedule();
      });
      return inFlight;
    };
    // A refresh after a mutation waits out an existing read, then gets fresh state.
    refreshRef.current = async () => {
      if (inFlight) await inFlight;
      return tick();
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

  return {
    data,
    error,
    loading,
    reconnecting,
    observedAt,
    refresh: () => refreshRef.current(),
    set: (next) => {
      generation.current += 1; // An older in-flight response cannot replace a mutation result.
      dataRef.current = next;
      terminal.current = false;
      failures.current = 0;
      setData(next);
      setError(null);
      setReconnecting(false);
      scheduleRef.current();
    },
  };
}
