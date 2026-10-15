import { beforeEach, expect, it, vi } from "vitest";
const { GET, POST } = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock("../src/lib/client/real-api", () => ({
  client: { GET, POST },
  meta: () => ({ "X-Schema-Version": "workagent/v1" }),
  command: (id: string) => ({
    command_id: id,
    request_id: id,
    schema_version: "workagent/v1",
  }),
  unwrap: (value: unknown) => value,
  all: async (fetch: () => Promise<{ items: unknown[] }>) =>
    (await fetch()).items,
}));
import { areaHref, workAreas } from "../src/lib/client/work-areas";
const input = {
  title: "Offer",
  goal: "Bound the pilot",
  kind: "project" as const,
};
beforeEach(() => {
  GET.mockReset();
  POST.mockReset();
});
it("uses workspace and canonical conversation identity in a stable URL", () => {
  expect(areaHref("workspace", "conversation")).toBe(
    "/spaces/workspace/work/conversation",
  );
});
it("reads back a created Space and preserves command identity", async () => {
  POST.mockResolvedValue({ id: "c" });
  GET.mockResolvedValue({ conversation: { id: "c" } });
  await expect(workAreas.create("w", input, "command-1")).resolves.toEqual({
    id: "c",
  });
  expect(POST.mock.calls[0]![1].body).toEqual({
    ...input,
    command_id: "command-1",
    request_id: "command-1",
    schema_version: "workagent/v1",
    selected_source_refs: [],
  });
  expect(GET.mock.calls[0]![1].params.path).toEqual({
    workspace_id: "w",
    conversation_id: "c",
  });
});
it("preserves expected version for human metadata updates", async () => {
  POST.mockResolvedValue({ id: "c" });
  GET.mockResolvedValue({ conversation: { id: "c" } });
  await workAreas.promote("w", "c", 7, input, "stable");
  expect(POST.mock.calls[0]![1].body.expected_work_version).toBe(7);
  expect(GET).toHaveBeenCalledOnce();
});
it("does not retry an ambiguous mutation or readback", async () => {
  POST.mockResolvedValue({ id: "c" });
  GET.mockRejectedValue(new Error("readback failed"));
  await expect(workAreas.create("w", input, "stable")).rejects.toThrow(
    "readback failed",
  );
  expect(POST).toHaveBeenCalledOnce();
  expect(GET).toHaveBeenCalledOnce();
});
it("does not infer a Space from a plain chat title or request", async () => {
  GET.mockResolvedValue({ items: [] });
  expect(await workAreas.list("w")).toEqual([]);
  expect(GET.mock.calls[0]![0]).toBe(
    "/v1/workspaces/{workspace_id}/work-areas",
  );
  expect(POST).not.toHaveBeenCalled();
});
