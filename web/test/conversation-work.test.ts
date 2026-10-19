import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/contract/errors";

// One paged summary read per workspace (GET …/conversation-work).
const { pages, get } = vi.hoisted(() => {
  const pages: Record<string, unknown[][]> = {};
  const get = vi.fn();
  return { pages, get };
});
vi.mock("../src/lib/client/real-api", () => ({
  client: { GET: get },
  meta: () => ({}),
  unwrap: async <T>(p: Promise<T>) => p,
  all: async <T>(
    fetchPage: (
      cursor?: string,
    ) => Promise<{ items: T[]; next_cursor?: string | null }>,
  ) => {
    const items: T[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await fetchPage(cursor);
      items.push(...page.items);
      if (!page.next_cursor) return items;
      cursor = page.next_cursor;
    }
  },
}));
vi.mock("../src/lib/client/capabilities", () => ({
  CAPABILITIES: { conversation: true },
}));
vi.mock("../src/lib/client/hooks", () => ({ useResource: vi.fn() }));

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
const down = () =>
  new ApiError({ code: "transport", status: 0, message: "Down." });

function item(ws: string, aid: string, over: Record<string, unknown> = {}) {
  return {
    workspace_id: ws,
    conversation_id: "c1",
    conversation_title: "First",
    conversation_state: "open",
    conversation_updated_at: "2026-10-06T09:00:00Z",
    conversation_work_version: 3,
    artifact_id: aid,
    title: `Title ${aid}`,
    kind: "table",
    revision_id: `${aid}-r2`,
    revision_number: 2,
    author_id: "local-human",
    author_kind: "human",
    updated_at: "2026-10-06T10:00:00Z",
    decision: null,
    ...over,
  };
}

function workspace(ws: string) {
  // Two pages, in artifact order, not attention order.
  return [
    [
      item(ws, "a-plain", {
        conversation_id: "c2",
        conversation_title: "Second",
        kind: "tool",
        title: "Calculator",
        author_kind: "worker",
        updated_at: "2026-10-06T12:00:00Z",
      }),
      item(ws, "a-stale", {
        decision: {
          proposal_id: "p-stale",
          base_revision_id: "a-stale-r1",
          base_work_version: 2,
          status: "pending",
          created_at: "2026-10-06T11:30:00Z",
          fresh: false,
        },
      }),
    ],
    [
      item(ws, "a-fresh", {
        decision: {
          proposal_id: "p-fresh",
          base_revision_id: "a-fresh-r2",
          base_work_version: 3,
          status: "pending",
          created_at: "2026-10-06T11:00:00Z",
          fresh: true,
        },
      }),
    ],
  ];
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const k of Object.keys(pages)) delete pages[k];
  pages.w = workspace("w");
  pages.v = workspace("v");
  get.mockImplementation(
    async (
      _path: string,
      opts: {
        params: { path: { workspace_id: string }; query: { cursor?: string } };
      },
    ) => {
      const ws = opts.params.path.workspace_id;
      if (ws === "hidden") throw hidden();
      if (ws === "down") throw down();
      const list = pages[ws] ?? [[]];
      const at = opts.params.query.cursor
        ? Number(opts.params.query.cursor)
        : 0;
      return {
        items: list[at],
        has_more: at + 1 < list.length,
        next_cursor: at + 1 < list.length ? String(at + 1) : null,
      };
    },
  );
});

describe("conversation-owned work on Home and Spaces", () => {
  it("reads every page of the summary, then puts decisions first", async () => {
    const rows = await loadConversationWork("w");
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0]![0]).toBe(
      "/v1/workspaces/{workspace_id}/conversation-work",
    );
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
    expect(stale!.decision?.fresh).toBe(false);
    expect(plain!).toMatchObject({
      conversation_id: "c2",
      conversation_title: "Second",
      kind: "tool",
      title: "Calculator",
      saved_by: "agent",
      decision: null,
    });
    expect(fresh!.saved_by).toBe("you");
  });

  it("surfaces real failures instead of hiding them", async () => {
    get.mockRejectedValue(down());
    await expect(loadConversationWork("w")).rejects.toThrow("Down.");
  });
});

describe("Home's work across every workspace", () => {
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
    const home = await loadHomeWork(["w", "hidden", "down"]);
    expect(home.unreadable).toBe(1);
    expect(new Set(home.items.map((r) => r.workspace_id))).toEqual(
      new Set(["w"]),
    );
  });

  it("fails as a whole only when no workspace can be read", async () => {
    get.mockRejectedValue(down());
    await expect(loadHomeWork(["w", "v"])).rejects.toThrow("Down.");
    expect(await loadHomeWork([])).toEqual({ items: [], unreadable: 0 });
  });
});
