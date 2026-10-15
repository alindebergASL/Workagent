import { describe, expect, it } from "vitest";
import { noteAuthors, viewBlocks } from "@/lib/document-blocks";

type Rev = Parameters<typeof noteAuthors>[1][number];
const note = (id: string, text: string) => ({
  block_id: id,
  kind: "protected_note" as const,
  text,
});
const para = (id: string, text: string) => ({
  block_id: id,
  kind: "paragraph" as const,
  text,
});
const rev = (
  id: string,
  n: number,
  author: "human" | "worker",
  parent: string | null,
  blocks: unknown[],
): Rev =>
  ({
    id,
    artifact_id: "a",
    author_id: author,
    author_kind: author,
    body: { title: "Doc", blocks },
    body_hash: id.padEnd(64, "0"),
    parent_revision_id: parent,
    revision_number: n,
    source_dependencies: [],
  }) as unknown as Rev;

describe("who added a kept note", () => {
  const r1 = rev("r1", 1, "worker", null, [
    para("b1", "Findings"),
    note("n1", "You asked: under EUR 700"),
  ]);
  const r2 = rev("r2", 2, "human", "r1", [
    para("b1", "Findings"),
    note("n1", "You asked: under EUR 700"),
    note("n2", "Call Northprint on Friday"),
  ]);
  const r3 = rev("r3", 3, "worker", "r2", [
    para("b1", "Findings, revised"),
    note("n1", "You asked: under EUR 700"),
    note("n2", "Call Northprint on Friday"),
  ]);

  it("is whoever first saved it as it reads now, back along its parents", () => {
    expect(noteAuthors(r3, [r1, r2, r3])).toEqual({
      n1: "worker",
      n2: "human",
    });
  });

  it("a later worker version keeping a person's note doesn't take it over", () => {
    expect(noteAuthors(r3, [r3, r2, r1]).n2).toBe("human");
  });

  it("rewording a note makes it the rewording author's", () => {
    const r4 = rev("r4", 4, "human", "r3", [
      note("n1", "Under EUR 700, delivery within 10 days"),
      note("n2", "Call Northprint on Friday"),
    ]);
    expect(noteAuthors(r4, [r1, r2, r3, r4]).n1).toBe("human");
  });

  it("is unknown when the history read doesn't reach where it started", () => {
    expect(noteAuthors(r3, [r3])).toEqual({});
    // Without r1 it can't tell whether n2 was already there.
    expect(noteAuthors(r3, [r2, r3])).toEqual({});
  });

  it("shows on the note only, for display", () => {
    const blocks = viewBlocks(
      (r3.body as { blocks: Parameters<typeof viewBlocks>[0] }).blocks,
      noteAuthors(r3, [r1, r2, r3]),
    );
    expect(blocks.map((b) => b.note_by)).toEqual([
      undefined,
      "worker",
      "human",
    ]);
  });
});
