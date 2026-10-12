import type { components } from "../../../contracts/src/client";
import type { Block } from "@/lib/contract/types";

/** Saved document blocks as the editor shows them, and back. */
type S = components["schemas"];

export function viewBlocks(blocks: S["Block"][]): Block[] {
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
