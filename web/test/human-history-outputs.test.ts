import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ usePage: vi.fn(), read: vi.fn() }));
vi.mock("../src/lib/client/discovery-page", () => ({ useDiscoveryPage: h.usePage }));
vi.mock("../src/lib/client/human-history", () => ({ responsibilityOutputPage: h.read }));
import { useResponsibilityOutputs } from "../src/lib/client/responsibility-outputs";

beforeEach(() => { h.usePage.mockReset(); h.read.mockReset(); });
const item = (id: number) => ({ artifact_id: `artifact-${id}`, revision_id: `revision-${id}`,
  title: `Current title ${id}`, conversation_id: "cv" as string | null, assignment_id: null as string | null });
const state = (items: ReturnType<typeof item>[], has_more = true) => ({
  page: { items, next_after: has_more ? items.at(-1)?.artifact_id : null, has_more },
  loading: false, unavailable: false, hasPrevious: false, next: vi.fn(), first: vi.fn(), refresh: vi.fn(),
});

it("the real responsibility UI hook discovers beyond the legacy artifact-ID summary", async () => {
  const ids: string[] = [];
  for (let offset = 0; offset < 137; offset += 25) {
    const page = state(Array.from({ length: Math.min(25, 137 - offset) }, (_, i) => item(offset + i)), offset + 25 < 137);
    h.usePage.mockReturnValue(page);
    const view = useResponsibilityOutputs("ws", "assignment", { conversation_id: "cv", artifact_ids: [] });
    expect(h.usePage.mock.lastCall?.[0]).toBe("responsibility-outputs:ws:assignment");
    ids.push(...view.outputs.map((o) => o.id));
    expect(view.hasMore).toBe(page.page.has_more);
    expect(view.next).toBe(page.next);
    expect(view.outputs[0]).toMatchObject({ kind: "ready", stale: false,
      href: `/conversations/cv/artifacts/artifact-${offset}`, title: `Current title ${offset}` });
  }
  expect(new Set(ids).size).toBe(137);
  const signal = new AbortController().signal;
  await h.usePage.mock.lastCall?.[1](signal, "authorized-anchor");
  expect(h.read).toHaveBeenCalledWith("ws", "assignment", signal, "authorized-anchor");
});

it.each(["assignment-only", "mixed"])("pages every %s output to its canonical owner, independent of the first 100", (kind) => {
  const source = Array.from({ length: 237 }, (_, i) => ({ ...item(i),
    conversation_id: kind === "mixed" && i < 137 ? "cv" : null,
    assignment_id: kind === "mixed" && i < 137 ? null : "original-owner",
  }));
  const seen: string[] = [];
  for (let offset = 0; offset < source.length; offset += 25) {
    const items = source.slice(offset, offset + 25);
    h.usePage.mockReturnValue(state(items, offset + 25 < source.length));
    const view = useResponsibilityOutputs("ws", "assignment", {
      conversation_id: "cv", artifact_ids: source.slice(0, 100).map((o) => o.artifact_id),
    });
    expect(view.outputs).toEqual(items.map((o) => ({ id: o.artifact_id,
      kind: "ready", title: o.title, stale: false,
      href: o.assignment_id ? `/assignments/${o.assignment_id}/artifacts/${o.artifact_id}`
        : `/conversations/${o.conversation_id}/artifacts/${o.artifact_id}`,
    })));
    seen.push(...view.outputs.map((o) => o.id));
  }
  expect(seen).toEqual(source.map((o) => o.artifact_id));
  expect(new Set(seen).size).toBe(237);
});

it("failed current access removes titles instead of retaining a stale output cache", () => {
  h.usePage.mockReturnValue(state([item(1)]));
  expect(useResponsibilityOutputs("ws", "assignment", { conversation_id: "cv", artifact_ids: [] }).outputs).toHaveLength(1);
  h.usePage.mockReturnValue({ ...state([]), page: null, unavailable: true });
  const view = useResponsibilityOutputs("ws", "assignment", { conversation_id: "cv", artifact_ids: [] });
  expect(view.outputs).toEqual([]); expect(view.unavailable).toBe(true); expect(view.hasMore).toBe(false);
  useResponsibilityOutputs("ws", "assignment", null);
  expect(h.usePage.mock.lastCall?.[0]).toBeNull();
});
