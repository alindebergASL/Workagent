import type { components } from "../../../contracts/src/client";
import type { Block } from "@/lib/contract/types";

/** Saved document blocks as the editor shows them, and back. */
type S = components["schemas"];

/** Who added each kept note of a saved version, where history shows it. */
export type NoteAuthors = Record<string, "human" | "worker">;

const notesOf = (body: unknown): Map<string, string> => {
  const blocks = (body as { blocks?: unknown })?.blocks;
  const out = new Map<string, string>();
  if (Array.isArray(blocks))
    for (const b of blocks as S["Block"][])
      if (b.kind === "protected_note") out.set(b.block_id, b.text);
  return out;
};

/**
 * Who added each kept note in `current`: the author of the earliest version,
 * back along its parents, where that note first appears as it reads now. A
 * note whose start lies outside the history read is left out (unknown).
 */
export function noteAuthors(
  current: S["Revision"] | undefined,
  history: S["Revision"][],
): NoteAuthors {
  const out: NoteAuthors = {};
  if (!current) return out;
  const byId = new Map(history.map((r) => [r.id, r]));
  for (const [id, text] of notesOf(current.body)) {
    let at = current;
    let known = true;
    while (at.parent_revision_id) {
      const parent = byId.get(at.parent_revision_id);
      if (!parent) {
        known = false;
        break;
      }
      if (notesOf(parent.body).get(id) !== text) break;
      at = parent;
    }
    if (known) out[id] = at.author_kind;
  }
  return out;
}

export function viewBlocks(
  blocks: S["Block"][],
  authors?: NoteAuthors,
): Block[] {
  return blocks.map((b) => ({
    id: b.block_id,
    kind:
      b.kind === "checklist"
        ? "check_item"
        : b.kind === "heading"
          ? "heading"
          : "paragraph",
    text: b.text,
    backend_kind: b.kind,
    ...("checked" in b ? { checked: Boolean(b.checked) } : {}),
    ...(b.kind === "protected_note" && authors?.[b.block_id]
      ? { note_by: authors[b.block_id] }
      : {}),
  }));
}

export function savedBody(title: string, blocks: Block[]): S["Body"] {
  return {
    title,
    blocks: blocks.map((b) => ({
      block_id: b.id,
      kind:
        b.backend_kind ??
        (b.kind === "check_item"
          ? "checklist"
          : b.kind === "heading"
            ? "heading"
            : "paragraph"),
      text: b.text,
      ...((b.backend_kind ??
        (b.kind === "check_item" ? "checklist" : "paragraph")) === "checklist"
        ? { checked: Boolean(b.checked) }
        : {}),
    })),
  };
}
