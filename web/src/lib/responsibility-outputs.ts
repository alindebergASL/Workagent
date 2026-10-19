import type { components } from "../../../contracts/src/client";

type S = components["schemas"];

/**
 * The published outputs a rich responsibility read projects: ids on
 * `detail.assignment.artifact_ids` whose work is canonically owned by the
 * responsibility's conversation. The legacy assignment read does not carry
 * them; they are read one by one (bounded) and open at their canonical
 * conversation address, never through the assignment's own artifact route.
 */

/** At most this many projected outputs are read for titles and ownership. */
export const OUTPUT_READ_LIMIT = 20;

/** What one bounded read of a projected output said, frozen at read time. */
export type OutputRead =
  | {
      kind: "ready";
      conversation_id: string | null;
      assignment_id: string | null;
      title: string;
      /** Kept from an earlier read while a re-read is failing. */
      stale?: boolean;
    }
  | { kind: "denied" }
  | { kind: "unknown" };

export type ResponsibilityOutput =
  /** Read and conversation-owned: its saved title and canonical address. */
  | { id: string; kind: "ready"; title: string; href: string; stale: boolean }
  /**
   * Beyond the read bound: the projection names its conversation, and its
   * page re-checks ownership before showing anything, so the canonical link
   * is still offered — without claiming a title that wasn't read.
   */
  | { id: string; kind: "unread"; href: string }
  /** This person can't read it; no destination is claimed. */
  | { id: string; kind: "denied" }
  /** The read failed; nothing about it is claimed until it can be re-read. */
  | { id: string; kind: "unknown" };

const conversationHref = (cid: string, aid: string) =>
  `/conversations/${cid}/artifacts/${aid}`;

/**
 * The responsibility's published outputs, from one frozen read set. Work the
 * read shows as assignment-owned is left out: the legacy saved-work list
 * already shows it, and listing it here would double it. A read that names a
 * different owning conversation links there — the artifact's own record is
 * canonical, not the projection.
 */
export function responsibilityOutputs(
  assignment: Pick<S["Assignment"], "conversation_id" | "artifact_ids">,
  reads: Record<string, OutputRead>,
): ResponsibilityOutput[] {
  const cid = assignment.conversation_id;
  if (!cid) return [];
  const ids = [...new Set(assignment.artifact_ids ?? [])];
  const out: ResponsibilityOutput[] = [];
  ids.forEach((id, i) => {
    const read = reads[id];
    if (!read) {
      if (i >= OUTPUT_READ_LIMIT)
        out.push({ id, kind: "unread", href: conversationHref(cid, id) });
      // Within the bound but not read yet: nothing is claimed about it.
      return;
    }
    if (read.kind === "denied" || read.kind === "unknown") {
      out.push({ id, kind: read.kind });
      return;
    }
    if (read.assignment_id || !read.conversation_id) return;
    out.push({
      id,
      kind: "ready",
      title: read.title,
      href: conversationHref(read.conversation_id, id),
      stale: Boolean(read.stale),
    });
  });
  return out;
}

/**
 * A failed re-read keeps what an earlier read said, marked stale, rather
 * than showing it as current or dropping it; a denied read replaces it.
 */
export function mergeOutputReads(
  previous: Record<string, OutputRead>,
  next: Record<string, OutputRead>,
): Record<string, OutputRead> {
  const out: Record<string, OutputRead> = {};
  for (const [id, read] of Object.entries(next)) {
    const before = previous[id];
    out[id] =
      read.kind === "unknown" && before?.kind === "ready"
        ? { ...before, stale: true }
        : read;
  }
  return out;
}
