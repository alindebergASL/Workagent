import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/contract/errors";

const { conv, prod } = vi.hoisted(() => ({
  conv: { list: vi.fn(), get: vi.fn() },
  prod: { get: vi.fn(), proposals: vi.fn() },
}));
vi.mock("../src/lib/client/real-api", () => ({ conversationApi: conv }));
vi.mock("../src/lib/client/capabilities", () => ({
  CAPABILITIES: { conversation: true },
}));
vi.mock("../src/lib/client/hooks", () => ({ useResource: vi.fn() }));
vi.mock("../src/lib/client/products", () => ({
  productApi: prod,
  isProduct: (b: { kind?: string }) => "kind" in b,
}));

import { loadConversationWork } from "../src/lib/client/conversation-work";

const hidden = () =>
  new ApiError({
    code: "not_found_or_not_authorized",
    status: 404,
    message: "Not found.",
  });

function artifact(id: string, cid: string, over: Record<string, unknown> = {}) {
  return {
    id,
    workspace_id: "w",
    conversation_id: cid,
    current_revision_id: `${id}-r2`,
    current_revision: {
      author_kind: "human",
      created_at: "2026-10-06T10:00:00Z",
      body: { kind: "table", title: `Title ${id}` },
    },
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  conv.list.mockResolvedValue([
    { id: "c1", title: "First" },
    { id: "c2", title: "Second" },
    { id: "gone", title: "Hidden" },
  ]);
  conv.get.mockImplementation(async (_ws: string, id: string) => {
    if (id === "gone") throw hidden();
    return {
      c1: { artifact_ids: ["a-fresh", "a-stale", "a-other-conv", "a-404"] },
      c2: { artifact_ids: ["a-plain", "a-fresh"] },
    }[id];
  });
  prod.get.mockImplementation(async (_ws: string, aid: string) => {
    if (aid === "a-404") throw hidden();
    if (aid === "a-other-conv") return artifact(aid, "someone-else");
    if (aid === "a-plain")
      return artifact(aid, "c2", {
        current_revision: {
          author_kind: "worker",
          created_at: "2026-10-06T12:00:00Z",
          body: { kind: "tool", title: "Calculator" },
        },
      });
    return artifact(aid, "c1");
  });
  prod.proposals.mockImplementation(async (_ws: string, aid: string) => {
    if (aid === "a-fresh")
      return [
        { id: "p-old", status: "accepted", base_revision_id: "x" },
        {
          id: "p-fresh",
          status: "pending",
          base_revision_id: "a-fresh-r2",
          created_at: "2026-10-06T11:00:00Z",
        },
      ];
    if (aid === "a-stale")
      return [
        {
          id: "p-stale",
          status: "pending",
          base_revision_id: "a-stale-r1",
          created_at: "2026-10-06T11:30:00Z",
        },
      ];
    return [];
  });
});

describe("conversation-owned work on Home and Spaces", () => {
  it("joins only authorized, conversation-owned products and their decisions", async () => {
    const rows = await loadConversationWork("w");
    expect(rows.map((r) => r.artifact_id)).toEqual([
      "a-fresh", // a decision you can act on leads
      "a-stale", // then a decision that can only be dismissed
      "a-plain", // then saved work, newest first
    ]);
    const [fresh, stale, plain] = rows;
    expect(fresh!.decision).toEqual({
      proposal_id: "p-fresh",
      fresh: true,
      created_at: "2026-10-06T11:00:00Z",
    });
    expect(fresh!.conversation_id).toBe("c1");
    expect(stale!.decision?.fresh).toBe(false);
    expect(plain!).toMatchObject({
      conversation_id: "c2",
      kind: "tool",
      title: "Calculator",
      saved_by: "agent",
      decision: null,
    });
  });

  it("surfaces real failures instead of hiding them", async () => {
    prod.get.mockRejectedValue(
      new ApiError({ code: "transport", status: 0, message: "Down." }),
    );
    await expect(loadConversationWork("w")).rejects.toThrow("Down.");
  });
});
