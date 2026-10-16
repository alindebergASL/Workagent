"use client";
import { CAPABILITIES } from "./capabilities";
import { useResource, type Resource } from "./hooks";
import { isProduct, productApi } from "./products";
import { flexibleKind } from "@/lib/flexible";
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
  kind:
    "table" | "tool" | "file" | "document" | "structured_table" | "custom_view";
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
            const kind = isProduct(body) ? body.kind : flexibleKind(body);
            if (!kind) return [];
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
                kind,
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
    .sort(byAttention);
}

/** Decisions you can act on first, then everything newest first. */
function byAttention(a: ConversationWork, b: ConversationWork): number {
  const rank = (w: ConversationWork) =>
    w.decision?.fresh ? 0 : w.decision ? 1 : 2;
  return (
    rank(a) - rank(b) ||
    (b.decision?.created_at ?? b.updated_at).localeCompare(
      a.decision?.created_at ?? a.updated_at,
    )
  );
}

/** Home's work across every workspace the person can open. */
export interface HomeWork {
  items: ConversationWork[];
  /** Workspaces whose work couldn't be read just now; never shown as empty. */
  unreadable: number;
}

/**
 * The work conversations own in each workspace the server lists for this
 * person, as one list: Home is one agent's view, not one workspace's. Each
 * item keeps its own workspace, so its links open it there. A workspace the
 * caller can't see is left out; one that can't be read is counted, so the
 * page can say so, and only when none can be read does the whole read fail.
 */
export async function loadHomeWork(
  workspaceIds: string[],
  signal?: AbortSignal,
): Promise<HomeWork> {
  const reads = await Promise.allSettled(
    workspaceIds.map((ws) => loadConversationWork(ws, signal)),
  );
  const items: ConversationWork[] = [];
  const failures: unknown[] = [];
  for (const r of reads) {
    if (r.status === "fulfilled") items.push(...r.value);
    else if (!hidden(r.reason)) failures.push(r.reason);
  }
  if (failures.length && failures.length === workspaceIds.length)
    throw failures[0];
  return { items: items.sort(byAttention), unreadable: failures.length };
}

export function useHomeWork(workspaceIds: string[]): Resource<HomeWork> {
  const ids = [...new Set(workspaceIds)].sort();
  return useResource<HomeWork>(
    ids.length && CAPABILITIES.conversation
      ? `home-work:${ids.join(",")}`
      : null,
    (signal) => loadHomeWork(ids, signal),
    { pollMs: 15000, shouldPoll: () => true },
  );
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
