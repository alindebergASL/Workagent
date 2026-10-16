"use client";
import { useCallback, useEffect, useState } from "react";
import type { ConversationWork } from "./conversation-work";
import { highWater, later } from "@/lib/since-you-left";

/**
 * Where "Since you left" starts, kept on this device until the service
 * records what a person has seen. The device remembers the newest saved
 * record Home showed it (`workagent:seen:<ws>`). Each tab fixes its starting
 * point when it first opens Home (`workagent:since:<ws>`), so a reload doesn't
 * empty the list; "Got it" moves the tab's starting point to now.
 * `undefined` while not yet read; `null` on a first visit (nothing to say).
 */
export function useSinceMarker(
  wsId: string | null,
  made: ConversationWork[] | null,
): { since: string | null | undefined; seenAll: () => void } {
  const [since, setSince] = useState<string | null | undefined>(undefined);
  const seenKey = `workagent:seen:${wsId}`;
  const sinceKey = `workagent:since:${wsId}`;

  useEffect(() => {
    if (!wsId) return;
    let start: string | null = null;
    try {
      const tab = sessionStorage.getItem(sinceKey);
      if (tab !== null) start = JSON.parse(tab) as string | null;
      else {
        start = localStorage.getItem(seenKey);
        sessionStorage.setItem(sinceKey, JSON.stringify(start));
      }
    } catch {
      start = null;
    }
    setSince(start);
  }, [wsId, seenKey, sinceKey]);

  // Remember the newest record shown, for the next visit.
  const newest = made ? highWater(made) : null;
  useEffect(() => {
    if (!wsId || since === undefined || !newest) return;
    try {
      if (later(newest, localStorage.getItem(seenKey)))
        localStorage.setItem(seenKey, newest);
    } catch {
      /* storage unavailable: the list just won't carry across visits */
    }
  }, [wsId, since, newest, seenKey]);

  const seenAll = useCallback(() => {
    if (!newest) return;
    setSince(newest);
    try {
      sessionStorage.setItem(sinceKey, JSON.stringify(newest));
    } catch {
      /* the choice holds for this page only */
    }
  }, [newest, sinceKey]);

  return { since, seenAll };
}
