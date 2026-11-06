/**
 * A draft the person never touched follows the worker's advancing saves;
 * a draft with any human work never does. Seen live: a document open in
 * Result view while the model generated revisions 1→6 claimed "The saved
 * version changed" and "Your edits aren't saved yet" with zero interaction.
 */
import { describe, expect, it } from "vitest";
import { pristineBehind } from "@/lib/pristine-draft";

const body = (text: string) => ({ title: "Demo preparation", text });
const r1 = { id: "r1", body: body("first") };
const r6 = { id: "r6", body: body("sixth") };
const history = [r1, r6];

const untouched = { base: "r1", body: body("first"), pending: null };

describe("a pristine draft behind an advancing saved version", () => {
  it("follows the worker's saves when the person did nothing", () => {
    expect(pristineBehind(untouched, "r6", history)).toBe(true);
  });

  it("is not re-based while the saved version hasn't moved", () => {
    expect(pristineBehind(untouched, "r1", history)).toBe(false);
  });

  it("keeps a draft with real edits exactly as it is", () => {
    const edited = { ...untouched, body: body("my own words") };
    expect(pristineBehind(edited, "r6", history)).toBe(false);
  });

  it("keeps a draft while a save awaits acknowledgement", () => {
    // The journaled write must survive the remote advance and reconnect:
    // re-basing would discard what the person asked to save.
    const saving = {
      ...untouched,
      pending: { kind: "save", id: "op", base: "r1", body: body("first") },
    };
    expect(pristineBehind(saving, "r6", history)).toBe(false);
  });

  it("keeps a draft with values typed outside the saved body", () => {
    // Raw cell text or unapplied tool inputs are human work even when the
    // body itself still equals the base.
    expect(pristineBehind(untouched, "r6", history, { touched: true })).toBe(
      false,
    );
  });

  it("never re-bases when its base isn't in the history read", () => {
    // Pristineness can't be proven, so the conservative warnings stay.
    expect(pristineBehind({ ...untouched, base: "r0" }, "r6", history)).toBe(
      false,
    );
  });

  it("compares through the editor's own normalization on both sides", () => {
    // The editor holds the body in display shape; equality must be judged
    // in the shape a save would send, as the dirty flag does.
    const display = { base: "r1", body: body(" first "), pending: null };
    const normalize = (b: { title: string; text: string }) => ({
      ...b,
      text: b.text.trim(),
    });
    expect(pristineBehind(display, "r6", history)).toBe(false);
    expect(pristineBehind(display, "r6", history, { normalize })).toBe(true);
  });
});
