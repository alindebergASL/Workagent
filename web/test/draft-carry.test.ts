import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { carryDraftHome } from "@/lib/client/conversation-reply";
import { scopedKey } from "./scope-helper";

describe("carryDraftHome", () => {
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

  it("moves an unsent message to Home's composer for the workspace", () => {
    expect(carryDraftHome("ws1", "Plan the room swap")).toBe(true);
    expect(store.get(scopedKey("workagent:composer-draft:ws1"))).toBe(
      "Plan the room swap",
    );
  });

  it("never overwrites a draft already waiting on Home", () => {
    store.set(scopedKey("workagent:composer-draft:ws1"), "Earlier idea");
    expect(carryDraftHome("ws1", "Plan the room swap")).toBe(false);
    expect(store.get(scopedKey("workagent:composer-draft:ws1"))).toBe(
      "Earlier idea",
    );
  });

  it("carries nothing for an empty message", () => {
    expect(carryDraftHome("ws1", "  ")).toBe(false);
    expect(store.size).toBe(0);
  });

  it("reports failure when storage is unavailable", () => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    expect(carryDraftHome("ws1", "Plan the room swap")).toBe(false);
  });
});
