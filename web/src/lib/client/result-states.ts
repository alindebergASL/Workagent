"use client";
import type { components } from "../../../../contracts/src/client";
import type { ChatMessage } from "@/lib/contract/types";
import type { ResultState } from "@/lib/result-links";
import { useResource } from "./hooks";
import { productApi } from "./products";
import { ApiError } from "@/lib/contract/errors";

type S = components["schemas"];

export interface WorkNow {
  current_revision_id: string;
  proposals: S["Proposal"][];
}

/**
 * Where each piece of work a conversation's messages link to stands now: its
 * current saved version and its proposals. Read only; work this caller can't
 * read is simply absent, and its links then claim nothing.
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
  return useResource<Record<string, WorkNow>>(key, async (signal) => {
    const entries = await Promise.all(
      ids.map(async (aid) => {
        try {
          const [artifact, proposals] = await Promise.all([
            productApi.get(ws!, aid, signal),
            productApi.proposals(ws!, aid, signal),
          ]);
          return [
            aid,
            { current_revision_id: artifact.current_revision_id, proposals },
          ] as const;
        } catch (e) {
          // Unreadable work claims nothing; a lost connection is retried.
          if (e instanceof ApiError && e.code !== "transport") return null;
          throw e;
        }
      }),
    );
    return Object.fromEntries(entries.filter((e) => e !== null));
  });
}

/** The state one message's result link needs, from what was read. */
export function resultState(
  now: Record<string, WorkNow> | null,
  product: Pick<S["ProductResult"], "artifact_id" | "proposal_id">,
): ResultState | null {
  const work = now?.[product.artifact_id];
  if (!work) return null;
  return {
    current_revision_id: work.current_revision_id,
    proposal: product.proposal_id
      ? (work.proposals.find((p) => p.id === product.proposal_id) ?? null)
      : null,
  };
}
