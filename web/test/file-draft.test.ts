import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearFileDraft,
  draftMatchesBase,
  failedWriteOutcome,
  readFileDraft,
  writeFileDraft,
  type FileDraftRecord,
} from "@/lib/file-draft";

const draft: FileDraftRecord = {
  workspace_file_id: "f1",
  base_version_id: "v1",
  base_sha256: "a".repeat(64),
  content: "edited text",
  saved_at: "2026-10-28T00:00:00Z",
};

describe("file drafts", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });

  it("survives a panel switch or reload keyed by file id", () => {
    writeFileDraft(draft);
    expect(readFileDraft("f1")).toEqual(draft);
    expect(readFileDraft("other")).toBeNull();
  });

  it("is cleared once a save is acknowledged", () => {
    writeFileDraft(draft);
    clearFileDraft("f1");
    expect(readFileDraft("f1")).toBeNull();
  });

  it("only re-enters the editor for the exact base version and bytes", () => {
    expect(draftMatchesBase(draft, "v1", "a".repeat(64))).toBe(true);
    expect(draftMatchesBase(draft, "v2", "a".repeat(64))).toBe(false);
    expect(draftMatchesBase(draft, "v1", "b".repeat(64))).toBe(false);
  });

  it("tolerates unavailable storage without throwing", () => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    expect(() => writeFileDraft(draft)).not.toThrow();
    expect(readFileDraft("f1")).toBeNull();
    expect(() => clearFileDraft("f1")).not.toThrow();
  });
});

describe("failed journaled create/save resolution", () => {
  it("a definite refusal of a never-ambiguous command ends it", () => {
    expect(failedWriteOutcome(false, false)).toEqual({
      keepPending: false,
      unknownOutcome: false,
    });
  });

  it("an ambiguous outcome keeps the exact journaled request", () => {
    expect(failedWriteOutcome(true, false)).toEqual({
      keepPending: true,
      unknownOutcome: true,
    });
  });

  it("a definitive rejection after earlier ambiguity never drops the journal", () => {
    // First attempt timed out (ambiguous), retry was definitively refused:
    // the first attempt may still have committed, so a fresh command must
    // never be offered — only the exact replay remains.
    expect(failedWriteOutcome(false, true)).toEqual({
      keepPending: true,
      unknownOutcome: true,
    });
  });

  it("a journal restored after a reload counts as earlier ambiguity", () => {
    // pending.restored === true stands in for everAmbiguous on restart; a
    // definitive rejection of the replay must keep the journal.
    const restored = true;
    expect(failedWriteOutcome(false, restored).keepPending).toBe(true);
  });
});
