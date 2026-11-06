"use client";
import { useDiscoveryPage } from "./discovery-page";
import { responsibilityOutputPage } from "./human-history";
import type { components } from "../../../../contracts/src/client";
import { ApiError } from "@/lib/contract/errors";
import {
  OUTPUT_READ_LIMIT,
  type OutputRead,
  type ResponsibilityOutput,
} from "@/lib/responsibility-outputs";
import { API_MODE } from "./api";

import { limiter } from "./limit";
import { productApi } from "./products";

type S = components["schemas"];

// A few reads at a time, so a person's own request never queues behind them.
const outputRead = limiter(6);

/**
 * One bounded, read-only pass over a responsibility's projected outputs:
 * each artifact is read once for its saved title and its canonical owner.
 * A read this person isn't allowed is denied; any other failure is unknown,
 * never a fabricated title or owner.
 */
export async function loadOutputReads(
  ws: string,
  ids: string[],
  signal?: AbortSignal,
): Promise<Record<string, OutputRead>> {
  const entries = await Promise.all(
    ids
      .slice(0, OUTPUT_READ_LIMIT)
      .map(async (id): Promise<readonly [string, OutputRead]> => {
        try {
          const a = await outputRead(() => productApi.get(ws, id, signal));
          return [
            id,
            {
              kind: "ready",
              conversation_id: a.conversation_id ?? null,
              assignment_id: a.assignment_id ?? null,
              title: a.current_revision.body.title,
            },
          ] as const;
        } catch (e) {
          if (signal?.aborted) throw e;
          if (
            e instanceof ApiError &&
            (e.code === "not_found_or_not_authorized" ||
              e.code === "unauthenticated" ||
              e.status === 403)
          )
            return [id, { kind: "denied" }] as const;
          return [id, { kind: "unknown" }] as const;
        }
      }),
  );
  return Object.fromEntries(entries);
}

/**
 * Current authorized pages, independent of the legacy 100-ID summary.
 * Refresh reauthorizes the visible page; no stale title survives a refusal.
 */
export function useResponsibilityOutputs(
  ws: string | null,
  assignmentId: string,
  assignment: Pick<S["Assignment"], "conversation_id" | "artifact_ids"> | null,
) {
  const history = useDiscoveryPage(
    ws && API_MODE === "real" && assignment?.conversation_id
      ? `responsibility-outputs:${ws}:${assignmentId}`
      : null,
    (signal, after) =>
      responsibilityOutputPage(ws!, assignmentId, signal, after),
  );
  return {
    // Every authorized row needs a route here: the legacy summary is capped
    // and may contain only conversation outputs, displacing all originals.
    outputs: (history.page?.items ?? []).map((item): ResponsibilityOutput => {
      const owner = item.assignment_id
        ? `/assignments/${item.assignment_id}`
        : item.conversation_id
          ? `/conversations/${item.conversation_id}`
          : null;
      return owner
        ? {
            id: item.artifact_id,
            kind: "ready",
            title: item.title,
            href: `${owner}/artifacts/${item.artifact_id}`,
            stale: false,
          }
        : { id: item.artifact_id, kind: "unknown" };
    }),
    loading: history.loading,
    unavailable: history.unavailable,
    hasMore: Boolean(history.page?.has_more),
    hasPrevious: history.hasPrevious,
    next: history.next,
    first: history.first,
    refresh: history.refresh,
  };
}
