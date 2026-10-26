import { describe, expect, it } from "vitest";
import {
  editNotes,
  LIMITS,
  notesProblem,
  syncNotesUi,
  type NotesUi,
} from "@/lib/flexible";

/**
 * B2.1: a table's notes are separate strings. Editing them must keep every
 * saved string exactly (whitespace, line breaks, order, count); only the
 * explicit add/remove/move controls change the list's shape. The old editor
 * joined notes with "\n" and split, trimmed and dropped blank lines on each
 * keystroke, turning these five notes into fourteen (over the limit of ten).
 */
const FIVE = [
  "Venue shortlist:\n- Hall A\n- Hall B\n- Hall C\n- Hall D",
  "  Deposit due Friday.  ",
  "Contacts\n\nMara (catering)\nIo (AV)\n",
  "Single line.",
  "Budget\n  draft 1\n  draft 2\n\t(rounded)\n",
];
const TEN = Array.from({ length: LIMITS.notes }, (_, i) => `n${i + 1}\n`);

describe("table notes round-trip", () => {
  it("the five multiline notes are 17 lines joined", () => {
    expect(FIVE.join("\n").split("\n")).toHaveLength(17);
  });

  it("an untouched or retyped note keeps all five strings exactly", () => {
    const retyped = FIVE.reduce((n, t, i) => editNotes.set(n, i, t), FIVE);
    expect(retyped).toEqual(FIVE);
    expect(notesProblem(retyped, LIMITS.notes)).toBe("");
  });

  it("editing one note leaves the others byte-for-byte", () => {
    const next = editNotes.set(FIVE, 3, "Single line.\nNow two.");
    expect(next).toHaveLength(5);
    expect(next.filter((_, i) => i !== 3)).toEqual(
      FIVE.filter((_, i) => i !== 3),
    );
  });

  it("whitespace-only notes are kept (the service accepts them)", () => {
    const n = editNotes.set(FIVE, 1, "   ");
    expect(n[1]).toBe("   ");
    expect(notesProblem(n, LIMITS.notes)).toBe("");
  });

  it("an empty note is refused, not erased", () => {
    const n = editNotes.add(FIVE);
    expect(n).toEqual([...FIVE, ""]);
    expect(notesProblem(n, LIMITS.notes)).toMatch(/note 6, or remove it/);
  });

  it("reorders and removes only the note asked", () => {
    expect(editNotes.move(FIVE, 4, -1)).toEqual([
      FIVE[0],
      FIVE[1],
      FIVE[2],
      FIVE[4],
      FIVE[3],
    ]);
    expect(editNotes.move(FIVE, 0, -1)).toBe(FIVE);
    expect(editNotes.move(FIVE, 4, 1)).toBe(FIVE);
    expect(editNotes.remove(FIVE, 2)).toEqual([
      FIVE[0],
      FIVE[1],
      FIVE[3],
      FIVE[4],
    ]);
    expect(FIVE).toHaveLength(5);
  });

  it("ten notes are allowed; an eleventh is refused with nothing removed", () => {
    expect(notesProblem(TEN, LIMITS.notes)).toBe("");
    const eleven = [...TEN, "more"];
    expect(notesProblem(eleven, LIMITS.notes)).toBe(
      "Keep to 10 notes. There are 11; nothing has been removed.",
    );
    expect(eleven).toHaveLength(11);
  });
});

describe("notes editor memory across parent updates", () => {
  let n = 0;
  const fresh = () => `id-${++n}`;
  const start = (notes: string[]): NotesUi => ({
    source: notes,
    ids: notes.map(fresh),
    removed: null,
  });

  it("discard after a removal clears Undo, so it can't duplicate a note", () => {
    const saved = ["A", "B", "C"];
    const ui = start(saved);
    // Remove B: the editor sends this list and remembers B for Undo.
    const sent = editNotes.remove(saved, 1);
    const afterRemove: NotesUi = {
      source: sent,
      ids: [ui.ids[0]!, ui.ids[2]!],
      removed: { id: ui.ids[1]!, text: "B", at: 1 },
    };
    expect(syncNotesUi(afterRemove, sent, fresh)).toBe(afterRemove);
    // Discard: the parent puts back a copy of the saved list.
    const discarded = structuredClone(saved);
    const reset = syncNotesUi(afterRemove, discarded, fresh);
    expect(reset.removed).toBeNull();
    expect(reset.source).toBe(discarded);
    expect(reset.ids).toHaveLength(3);
    expect(new Set([...reset.ids, ...afterRemove.ids]).size).toBe(5);
  });

  it("the editor's own typing keeps identities and Undo", () => {
    const ui: NotesUi = {
      ...start(["A", "C"]),
      removed: { id: "gone", text: "B", at: 1 },
    };
    const typed = editNotes.set(ui.source, 0, "A!");
    const own = { ...ui, source: typed };
    expect(syncNotesUi(own, typed, fresh)).toBe(own);
  });

  it("a fresh empty list each render is not a replacement", () => {
    const ui = start([]);
    expect(syncNotesUi(ui, [], fresh)).toBe(ui);
  });

  it("an empty discard still clears a stale Undo", () => {
    const ui: NotesUi = {
      source: [],
      ids: [],
      removed: { id: "x", text: "added then removed", at: 0 },
    };
    expect(syncNotesUi(ui, [], fresh).removed).toBeNull();
  });
});
