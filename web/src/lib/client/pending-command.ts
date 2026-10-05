"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A command whose outcome is not yet known, kept for this tab across reloads.
 *
 * A write can commit on the server while its response is lost. If the page
 * then reloads and the person "sends again" with a fresh command ID, the
 * server can't tell it's the same intent and records it twice. Keeping the
 * exact command (ID and payload) means the only way forward is replaying it,
 * which the server answers with the original result, or a definite refusal
 * that clears it. The stored value holds no credential, only the person's own
 * words and IDs. It is per tab (sessionStorage) and never shared.
 */
export function usePendingCommand<T>(key: string | null) {
  const ref = useRef<T | null>(null);
  const [, bump] = useState(0);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    ref.current = null;
    setRestored(false);
    if (!key) return;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        ref.current = JSON.parse(raw) as T;
        setRestored(true);
      }
    } catch {
      /* unreadable or unavailable: nothing to restore */
    }
    bump((n) => n + 1);
  }, [key]);

  const set = useCallback(
    (value: T | null) => {
      ref.current = value;
      if (value === null) setRestored(false);
      if (key)
        try {
          if (value === null) sessionStorage.removeItem(key);
          else sessionStorage.setItem(key, JSON.stringify(value));
        } catch {
          /* storage unavailable: the in-memory command still holds */
        }
      bump((n) => n + 1);
    },
    [key],
  );

  const clear = useCallback(
    (expected: T): boolean => {
      if (ref.current !== expected) return false;
      if (key)
        try {
          // A completion from an old mount must not erase a newer journal entry.
          if (sessionStorage.getItem(key) !== JSON.stringify(expected))
            return false;
          sessionStorage.removeItem(key);
        } catch {
          /* storage unavailable: still resolve this exact in-memory command */
        }
      ref.current = null;
      setRestored(false);
      bump((n) => n + 1);
      return true;
    },
    [key],
  );

  return {
    get current(): T | null {
      return ref.current;
    },
    set,
    clear,
    /** True when the command came back from a previous load of this tab. */
    restored,
  };
}
