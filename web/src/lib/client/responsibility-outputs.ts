"use client";
import { useRef } from "react";
import type { components } from "../../../../contracts/src/client";
import { ApiError } from "@/lib/contract/errors";
import {
  mergeOutputReads,
  responsibilityOutputs,
  OUTPUT_READ_LIMIT,
  type OutputRead,
} from "@/lib/responsibility-outputs";
import { API_MODE } from "./api";
import { useResource } from "./hooks";
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
 * The saved outputs of one responsibility, from its rich read only (the
 * legacy assignment read does not project them). Re-read on focus and on
 * refresh; a failing re-read keeps earlier titles marked stale. Nothing here
 * sends a command.
 */
export function useResponsibilityOutputs(
  ws: string | null,
  assignmentId: string,
  assignment: Pick<S["Assignment"], "conversation_id" | "artifact_ids"> | null,
) {
  const ids = assignment?.conversation_id
    ? [...new Set(assignment.artifact_ids ?? [])]
    : [];
  const key =
    ws && API_MODE === "real" && ids.length
      ? `responsibility-outputs:${ws}:${assignmentId}:${ids.join(",")}`
      : null;
  // What was read belongs to one responsibility's current projection only.
  const previous = useRef<Record<string, OutputRead>>({});
  const lastKey = useRef(key);
  if (lastKey.current !== key) {
    lastKey.current = key;
    previous.current = {};
  }
  const res = useResource<Record<string, OutputRead>>(key, async (signal) => {
    const merged = mergeOutputReads(
      previous.current,
      await loadOutputReads(ws!, ids, signal),
    );
    previous.current = merged;
    return merged;
  });
  return {
    outputs:
      assignment && res.data ? responsibilityOutputs(assignment, res.data) : [],
    loading: Boolean(key) && res.loading,
    refresh: res.refresh,
  };
}
