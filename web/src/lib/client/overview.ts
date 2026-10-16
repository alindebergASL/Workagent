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

/** Home's handed-over work across every workspace the person can open. */
export interface HomeOverview {
  items: AssignmentSummary[];
  /** Workspaces whose work couldn't be read just now; never shown as empty. */
  unreadable: number;
}

/**
 * The work in each workspace the person can open, as one list, newest change
 * first: Home is one agent's view. Each item keeps its own workspace. A
 * workspace that can't be read is counted, never shown as empty; only when
 * none can be read does the read fail.
 */
export function useHomeOverview(
  workspaceIds: string[],
): Resource<HomeOverview> {
  const ids = [...new Set(workspaceIds)].sort();
  const active = useRef(false);
  return useResource<HomeOverview>(
    ids.length ? `home-overview:${ids.join(",")}` : null,
    async (signal) => {
      const reads = await Promise.allSettled(
        ids.map((ws) => api.listAssignments(ws, signal)),
      );
      const items: AssignmentSummary[] = [];
      const failures: unknown[] = [];
      for (const r of reads) {
        if (r.status === "fulfilled") items.push(...r.value.items);
        else failures.push(r.reason);
      }
      if (failures.length && failures.length === ids.length) throw failures[0];
      const sorted = items.sort((x, y) =>
        (y.updated_at || "").localeCompare(x.updated_at || ""),
      );
      active.current = sorted.some(isWorking);
      return { items: sorted, unreadable: failures.length };
    },
    {
      get pollMs() {
        return active.current ? 2500 : 10000;
      },
      shouldPoll: () => true,
    },
  );
}
