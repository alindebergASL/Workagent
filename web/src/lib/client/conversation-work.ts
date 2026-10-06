"use client";
import { CAPABILITIES } from "./capabilities";
import { useResource, type Resource } from "./hooks";
import { isProduct, productApi } from "./products";
import { conversationApi } from "./real-api";
import { ApiError } from "@/lib/contract/errors";

/**
 * A product a conversation owns, with any decision waiting on it. Read only
 * from existing records: the conversation's own `artifact_ids`, the artifact's
 * current saved revision, and its pending proposals. Nothing here creates an
 * assignment or invents a Space; a Space is exactly the workspace.
 */
export interface ConversationWork {
  workspace_id: string;
  conversation_id: string;
  conversation_title: string;
  artifact_id: string;
  title: string;
  kind: "table" | "tool" | "file";
  revision_id: string;
  updated_at: string;
  saved_by: "you" | "agent";
  /** The newest pending proposal, if any. Stale ones can't be applied. */
  decision: {
    proposal_id: string;
    fresh: boolean;
    created_at: string;
  } | null;
}

/** Records this caller can't see are left out rather than failing the list. */
function hidden(e: unknown) {
  return (
    e instanceof ApiError &&
    (e.code === "not_found_or_not_authorized" || e.status === 403)
  );
}

export async function loadConversationWork(
  ws: string,
  signal?: AbortSignal,
): Promise<ConversationWork[]> {
  const conversations = await conversationApi.list(ws, signal);
  const perConversation = await Promise.all(
    conversations.map(async (c) => {
      let detail;
      try {
        detail = await conversationApi.get(ws, c.id, signal);
      } catch (e) {
        if (hidden(e)) return [];
        throw e;
      }
      const rows = await Promise.all(
        detail.artifact_ids.map(async (aid): Promise<ConversationWork[]> => {
          try {
            const [artifact, proposals] = await Promise.all([
              productApi.get(ws, aid, signal),
              productApi.proposals(ws, aid, signal),
            ]);
            // Only work this conversation owns in this workspace.
            if (
              artifact.workspace_id !== ws ||
              artifact.conversation_id !== c.id
            )
              return [];
            const body = artifact.current_revision.body;
            if (!isProduct(body)) return [];
            const pending = proposals
              .filter((p) => p.status === "pending")
              .sort((a, b) =>
                (b.created_at ?? "").localeCompare(a.created_at ?? ""),
              )[0];
            return [
              {
                workspace_id: ws,
                conversation_id: c.id,
                conversation_title: c.title,
                artifact_id: artifact.id,
                title: body.title,
                kind: body.kind,
                revision_id: artifact.current_revision_id,
                updated_at: artifact.current_revision.created_at ?? "",
                saved_by:
                  artifact.current_revision.author_kind === "human"
                    ? "you"
                    : "agent",
                decision: pending
                  ? {
                      proposal_id: pending.id,
                      fresh:
                        pending.base_revision_id ===
                        artifact.current_revision_id,
                      created_at: pending.created_at ?? "",
                    }
                  : null,
              },
            ];
          } catch (e) {
            if (hidden(e)) return [];
            throw e;
          }
        }),
      );
      return rows.flat();
    }),
  );
  const seen = new Set<string>();
  return perConversation
    .flat()
    .filter((w) => {
      const key = `${w.workspace_id}:${w.artifact_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      // Decisions you can act on first, then everything newest first.
      const rank = (w: ConversationWork) =>
        w.decision?.fresh ? 0 : w.decision ? 1 : 2;
      return (
        rank(a) - rank(b) ||
        (b.decision?.created_at ?? b.updated_at).localeCompare(
          a.decision?.created_at ?? a.updated_at,
        )
      );
    });
}

export function useConversationWork(
  wsId: string | null,
): Resource<ConversationWork[]> {
  return useResource<ConversationWork[]>(
    wsId && CAPABILITIES.conversation ? `conversation-work:${wsId}` : null,
    (signal) => loadConversationWork(wsId!, signal),
    { pollMs: 15000, shouldPoll: () => true },
  );
}
