import type { Block } from "@/lib/contract/types";
import type { DiffOp } from "@/lib/diff";
import type { NoteAuthors } from "@/lib/document-blocks";

/**
 * One line of "What changed" in a proposed document, read from the diff of
 * the two saved bodies, never from the proposer's description of itself.
 */
export type ChangeItem =
  | { kind: "added" | "removed"; text: string }
  | { kind: "rewritten"; from: string; text: string }
  | { kind: "checked" | "unchecked"; text: string };

const same = (a: Block, b: Block) =>
  a.kind === "check_item" && b.kind === "check_item" && a.text === b.text;

/**
 * The changes in reading order. A part taken out where another is put in
 * reads as one rewrite; a checklist item whose only change is being ticked
 * reads as done or not done.
 */
export function changeItems(ops: DiffOp[]): ChangeItem[] {
  const out: ChangeItem[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i]!.type === "same") {
      i++;
      continue;
    }
    const removed: Block[] = [];
    const added: Block[] = [];
    while (i < ops.length && ops[i]!.type !== "same") {
      const op = ops[i]!;
      (op.type === "removed" ? removed : added).push(op.block);
      i++;
    }
    const pairs = Math.min(removed.length, added.length);
    for (let k = 0; k < pairs; k++) {
      const from = removed[k]!;
      const to = added[k]!;
      if (same(from, to))
        out.push({
          kind:
            to.kind === "check_item" && to.checked ? "checked" : "unchecked",
          text: to.text,
        });
      else out.push({ kind: "rewritten", from: from.text, text: to.text });
    }
    for (const b of removed.slice(pairs))
      out.push({ kind: "removed", text: b.text });
    for (const b of added.slice(pairs))
      out.push({ kind: "added", text: b.text });
  }
  return out;
}

type SavedBlock = { block_id: string; kind: string; text: string };

/**
 * What applying would do to the notes the person added themselves: how many
 * there are, and how many the proposal keeps word for word.
 */

export function yourNotes(
  saved: SavedBlock[],
  proposed: SavedBlock[],
  authors: NoteAuthors,
): { total: number; kept: number } {
  const after = new Map(proposed.map((b) => [b.block_id, b.text]));
  let total = 0;
  let kept = 0;
  for (const b of saved) {
    if (b.kind !== "protected_note" || authors[b.block_id] !== "human")
      continue;
    total++;
    if (after.get(b.block_id) === b.text) kept++;
  }
  return { total, kept };
}
