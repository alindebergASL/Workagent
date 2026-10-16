import { describe, expect, it } from "vitest";
import type { Block } from "../src/lib/contract/types";
import { diffBlocks } from "../src/lib/diff";
import { changeItems, yourNotes } from "../src/lib/proposal-changes";

const b = (id: string, text: string, over: Partial<Block> = {}): Block => ({
  id,
  kind: "paragraph",
  text,
  ...over,
});

describe("what changed, item by item", () => {
  it("reads a replaced part as a rewrite, and lone parts as added or taken out", () => {
    const saved = [
      b("1", "Open at 9."),
      b("2", "Check the bag."),
      b("3", "Close at 5."),
    ];
    const proposed = [
      b("1", "Open at 9."),
      b("2", "Check the item and borrower."),
      b("3", "Close at 5."),
      b("4", "Record the agreed return time."),
    ];
    expect(changeItems(diffBlocks(saved, proposed))).toEqual([
      {
        kind: "rewritten",
        from: "Check the bag.",
        text: "Check the item and borrower.",
      },
      { kind: "added", text: "Record the agreed return time." },
    ]);
    expect(changeItems(diffBlocks(proposed, saved))).toEqual([
      {
        kind: "rewritten",
        from: "Check the item and borrower.",
        text: "Check the bag.",
      },
      { kind: "removed", text: "Record the agreed return time." },
    ]);
  });

  it("a ticked or unticked item reads as done or not done", () => {
    const item = (checked: boolean) =>
      b("c", "Book the room", { kind: "check_item", checked });
    expect(changeItems(diffBlocks([item(false)], [item(true)]))).toEqual([
      { kind: "checked", text: "Book the room" },
    ]);
    expect(changeItems(diffBlocks([item(true)], [item(false)]))).toEqual([
      { kind: "unchecked", text: "Book the room" },
    ]);
  });

  it("nothing changed is no items", () => {
    expect(changeItems(diffBlocks([b("1", "Same")], [b("1", "Same")]))).toEqual(
      [],
    );
  });
});

describe("the person's own notes", () => {
  const note = (id: string, text: string) => ({
    block_id: id,
    kind: "protected_note",
    text,
  });
  it("counts only notes the person added, and which are kept word for word", () => {
    const saved = [
      note("n1", "Keep the repair bag on hold."),
      note("n2", "Ask Sam first."),
      note("w1", "Workagent's note."),
      { block_id: "p", kind: "paragraph", text: "Body" },
    ];
    const authors = { n1: "human", n2: "human", w1: "worker" } as const;
    expect(yourNotes(saved, saved, authors)).toEqual({ total: 2, kept: 2 });
    expect(
      yourNotes(saved, [note("n1", "Keep the repair bag on hold.")], authors),
    ).toEqual({ total: 2, kept: 1 });
    expect(
      yourNotes(
        saved,
        [note("n1", "Reworded."), note("n2", "Ask Sam first.")],
        authors,
      ),
    ).toEqual({ total: 2, kept: 1 });
    expect(yourNotes([], [], {})).toEqual({ total: 0, kept: 0 });
  });
});
