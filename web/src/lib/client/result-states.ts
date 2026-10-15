"use client";
import type { components } from "../../../../contracts/src/client";
import type { ChatMessage } from "@/lib/contract/types";
import type { ResultState } from "@/lib/result-links";
import { useRef } from "react";
import { useResource } from "./hooks";
import { productApi } from "./products";
import { ApiError } from "@/lib/contract/errors";

type S = components["schemas"];

export interface WorkNow {
  current_revision_id: string;
  proposals: S["Proposal"][];
  /** The work itself, as last read: what a reply's card previews. */
  artifact: S["Artifact"];
}

/** How the latest read of one piece of work went. */
export type ReadOutcome = "current" | "unconfirmed" | "unavailable";

export interface WorkRead {
  read: ReadOutcome;
  /**
   * The work as last read: current, or (when the latest read couldn't
   * confirm it) the previous read, said so. Never kept once access is
   * refused or the work is gone.
   */
  now: WorkNow | null;
}

const refused = (e: unknown) =>
  e instanceof ApiError &&
  (e.code === "not_found_or_not_authorized" || e.code === "unauthenticated");

/**
 * Where each piece of work a conversation's messages link to stands now: its
 * current saved version and its proposals. Read only. Each piece of work has
 * its own outcome, so one that's refused is dropped even when a sibling's read
 * fails, and one that can't be re-checked keeps its last read, marked as such.
 */
export function useResultStates(
  ws: string | null,
  messages: ChatMessage[] | undefined,
) {
  const ids = [
    ...new Set(
      (messages ?? []).flatMap((m) =>
        (m.products ?? []).map((p) => p.artifact_id),
      ),
    ),
  ].sort();
  // Re-read when the messages change, so a reply's new proposal is current.
  const key =
    ws && ids.length
      ? `result-states:${ws}:${ids.join(",")}:${messages?.length ?? 0}`
      : null;
  const lastGood = useRef<Record<string, WorkNow>>({});
  return useResource<Record<string, WorkRead>>(key, async (signal) => {
    const entries = await Promise.all(
      ids.map(async (aid): Promise<[string, WorkRead]> => {
        const at = `${ws}:${aid}`;
        // Both reads settle before deciding: a refusal from either wins,
        // whatever order they finish in; only a complete pair is kept.
        const [artifactRead, proposalsRead] = await Promise.allSettled([
          productApi.get(ws!, aid, signal),
          productApi.proposals(ws!, aid, signal),
        ]);
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        if (
          artifactRead.status === "fulfilled" &&
          proposalsRead.status === "fulfilled"
        ) {
          const now = {
            current_revision_id: artifactRead.value.current_revision_id,
            proposals: proposalsRead.value,
            artifact: artifactRead.value,
          };
          lastGood.current[at] = now;
          return [aid, { read: "current", now }];
        }
        const failures = [artifactRead, proposalsRead].flatMap((r) =>
          r.status === "rejected" ? [r.reason] : [],
        );
        if (failures.some(refused)) {
          delete lastGood.current[at];
          return [aid, { read: "unavailable", now: null }];
        }
        return [
          aid,
          { read: "unconfirmed", now: lastGood.current[at] ?? null },
        ];
      }),
    );
    return Object.fromEntries(entries);
  });
}

/** The state one message's result link needs, from what was read. */
export function resultState(
  reads: Record<string, WorkRead> | null,
  product: Pick<S["ProductResult"], "artifact_id" | "proposal_id">,
): ResultState | null {
  const work = reads?.[product.artifact_id]?.now;
  if (!work) return null;
  return {
    current_revision_id: work.current_revision_id,
    proposal: product.proposal_id
      ? (work.proposals.find((p) => p.id === product.proposal_id) ?? null)
      : null,
  };
}
