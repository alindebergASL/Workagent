"use client";
import { useRef } from "react";
import { api } from "./api";
import { useResource, type Resource } from "./hooks";
import type { AssignmentSummary } from "@/lib/contract/types";
import { isWorking } from "@/lib/work-state";

/**
 * Work in a space, newest change first. Summaries come from the adapter's
 * authoritative read model (pending proposals, approval and progress included),
 * so no extra per-assignment reads happen here.
 */
export function useWorkOverview(
  wsId: string | null,
): Resource<AssignmentSummary[]> {
  const active = useRef(false);
  return useResource<AssignmentSummary[]>(
    wsId ? `overview:${wsId}` : null,
    async (signal) => {
      const { items } = await api.listAssignments(wsId!, signal);
      const sorted = [...items].sort((x, y) =>
        (y.updated_at || "").localeCompare(x.updated_at || ""),
      );
      active.current = sorted.some(isWorking);
      return sorted;
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
