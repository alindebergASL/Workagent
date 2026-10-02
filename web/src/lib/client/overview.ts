"use client";
import { useRef } from "react";
import { api } from "./api";
import { useResource, type Resource } from "./hooks";
import type { WorkItem } from "@/lib/work-state";
import { phaseOf } from "@/lib/work-state";

/** Detail reads are bounded so Home stays cheap as work accumulates. */
const DETAIL_LIMIT = 8;

/**
 * Assignment list plus bounded detail reads. The summary endpoint does not
 * expose pending proposals, so pending decisions come from each assignment's
 * detail read (requested from the backend as a summary field; see
 * handoffs/frontend/STATUS.md). A failed detail read degrades to the summary.
 */
export function useWorkOverview(wsId: string | null): Resource<WorkItem[]> {
  const active = useRef(false);
  return useResource<WorkItem[]>(
    wsId ? `overview:${wsId}` : null,
    async (signal) => {
      const { items } = await api.listAssignments(wsId!, signal);
      const details = await Promise.all(
        items
          .slice(0, DETAIL_LIMIT)
          .map((s) => api.getAssignment(wsId!, s.id, signal).catch(() => null)),
      );
      const result = items.map((summary, i) => ({
        summary,
        detail: details[i] ?? null,
      }));
      active.current = hasActiveWork(result);
      return result;
    },
    {
      // Read at each scheduling: faster while something is in progress; the
      // slower idle read still picks up proposals finished by the dispatcher.
      get pollMs() {
        return active.current ? 2500 : 10000;
      },
      shouldPoll: () => true,
    },
  );
}

export function hasActiveWork(items: WorkItem[] | null): boolean {
  return Boolean(items?.some((i) => phaseOf(i) === "working"));
}
