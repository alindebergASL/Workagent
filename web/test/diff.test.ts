import { describe, expect, it } from "vitest";
import { condenseDiff, countChanges, diffBlocks } from "../src/lib/diff";
import type { Block } from "../src/lib/contract/types";

const p = (id: string, text: string): Block => ({
  id,
  kind: "paragraph",
  text,
});
const c = (id: string, text: string, checked: boolean): Block => ({
  id,
  kind: "check_item",
  text,
  checked,
});

describe("exact changes", () => {
  it("treats a checklist item's done state as a change", () => {
    const ops = diffBlocks(
      [c("a", "Pick a case", true)],
      [c("a", "Pick a case", false)],
    );
    expect(countChanges(ops)).toEqual({ added: 1, removed: 1 });
  });

  it("collapses unchanged runs so only the changes are shown", () => {
    const before = [p("1", "a"), p("2", "b"), p("3", "c"), p("4", "d")];
    const after = [
      p("1", "a"),
      p("2", "b"),
      p("3", "c"),
      p("4", "d"),
      p("5", "e"),
    ];
    const items = condenseDiff(diffBlocks(before, after));
    expect(items).toEqual([
      { type: "gap", count: 4 },
      { type: "added", block: p("5", "e") },
    ]);
  });
});
