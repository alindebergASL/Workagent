"use client";
import { api } from "./api";
import { useResource, type Resource } from "./hooks";
import type { WorkItem } from "@/lib/work-state";
import { phaseOf } from "@/lib/work-state";
/** The adapter already enriches every summary with durable proposal/approval receipts. */
export function useWorkOverview(wsId: string | null): Resource<WorkItem[]> {
  return useResource<WorkItem[]>(
    wsId ? `overview:${wsId}` : null,
    async (signal) => {
      const { items } = await api.listAssignments(wsId!, signal);
      return items.map((summary) => ({ summary, detail: null }));
    },
    { pollMs: 3000, shouldPoll: () => true },
  );
}
export function hasActiveWork(items: WorkItem[] | null): boolean {
  return Boolean(items?.some((i) => phaseOf(i) === "working"));
}
