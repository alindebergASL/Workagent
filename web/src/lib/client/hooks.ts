"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/contract/errors";

export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** True while the last poll failed and we are retrying the same resource. */
  reconnecting: boolean;
  observedAt: string | null;
  refresh: () => Promise<T | null>;
  /** Replace the local copy after a successful mutation. */
  set: (next: T) => void;
}

/**
 * Fetches a resource and, while `shouldPoll` is true, re-fetches it on an
 * interval. On failure it keeps the last good data, shows a reconnecting
 * state and retries with backoff. Reconnecting re-reads the same id; it never
 * creates anything.
 */
export function useResource<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: { pollMs?: number; shouldPoll?: (data: T | null) => boolean } = {},
): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(key));
  const [reconnecting, setReconnecting] = useState(false);
  const [observedAt, setObservedAt] = useState<string | null>(null);
  const failures = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const dataRef = useRef<T | null>(null);
  dataRef.current = data;

  const load = useCallback(
    async (signal?: AbortSignal): Promise<T | null> => {
      if (!key) return null;
      try {
        const next = await fetcherRef.current(
          signal ?? new AbortController().signal,
        );
        if (signal?.aborted) return null;
        failures.current = 0;
        setData(next);
        setError(null);
        setReconnecting(false);
        setObservedAt(new Date().toISOString());
        setLoading(false);
        return next;
      } catch (e) {
        if (signal?.aborted) return null;
        const err =
          e instanceof ApiError
            ? e
            : new ApiError({
                code: "transport",
                status: 0,
                message: "Request failed.",
              });
        failures.current += 1;
        if (
          err.code === "not_found_or_not_authorized" ||
          err.code === "unauthenticated"
        ) {
          // Access changed: do not keep showing stale content.
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
    if (!key) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    setLoading(true);
    const tick = async () => {
      const result = await load(controller.signal);
      if (stopped) return;
      const base = optionsRef.current.pollMs ?? 0;
      const shouldPoll = optionsRef.current.shouldPoll
        ? optionsRef.current.shouldPoll(result ?? dataRef.current)
        : base > 0;
      if (failures.current > 0 && dataRef.current) {
        timer = setTimeout(
          tick,
          Math.min(15000, 1500 * 2 ** Math.min(failures.current, 4)),
        );
      } else if (shouldPoll && base > 0) {
        timer = setTimeout(tick, base);
      }
    };
    void tick();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [key, load]);

  return {
    data,
    error,
    loading,
    reconnecting,
    observedAt,
    refresh: () => load(),
    set: (next) => setData(next),
  };
}
