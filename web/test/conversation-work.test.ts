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

import {
  loadConversationWork,
  loadHomeWork,
} from "../src/lib/client/conversation-work";

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

describe("Home's work across every workspace", () => {
  const down = () =>
    new ApiError({ code: "transport", status: 0, message: "Down." });
  beforeEach(() => {
    // Each workspace's artifacts belong to it.
    const own = prod.get.getMockImplementation()!;
    prod.get.mockImplementation(async (ws: string, aid: string) => ({
      ...(await own(ws, aid)),
      workspace_id: ws,
    }));
  });

  it("joins the work of each workspace, each keeping its own, decisions first", async () => {
    const home = await loadHomeWork(["w", "v"]);
    expect(home.unreadable).toBe(0);
    expect(home.items.map((r) => `${r.workspace_id}:${r.artifact_id}`)).toEqual(
      expect.arrayContaining([
        "w:a-fresh",
        "v:a-fresh",
        "w:a-plain",
        "v:a-plain",
      ]),
    );
    expect(home.items.slice(0, 2).every((r) => r.decision?.fresh)).toBe(true);
    expect(home.items.at(-1)!.decision).toBeNull();
  });

  it("leaves out a workspace the person can't see; counts one that can't be read", async () => {
    const list = conv.list.getMockImplementation();
    conv.list.mockImplementation(async (ws: string) => {
      if (ws === "hidden") throw hidden();
      if (ws === "down") throw down();
      return list!(ws);
    });
    const home = await loadHomeWork(["w", "hidden", "down"]);
    expect(home.unreadable).toBe(1);
    expect(new Set(home.items.map((r) => r.workspace_id))).toEqual(
      new Set(["w"]),
    );
  });

  it("fails as a whole only when no workspace can be read", async () => {
    conv.list.mockRejectedValue(down());
    await expect(loadHomeWork(["w", "v"])).rejects.toThrow("Down.");
    expect(await loadHomeWork([])).toEqual({ items: [], unreadable: 0 });
  });
});
