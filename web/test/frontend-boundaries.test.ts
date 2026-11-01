import { beforeEach, expect, it, vi } from "vitest";
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/client/real-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client/real-api")>();
  return { ...actual, client: { ...actual.client, GET: get } };
});
import { listFiles } from "@/lib/client/workspace-files";
import { limiter } from "@/lib/client/limit";
import { fenceScope } from "@/lib/client/session-scope";
import type { WorkspaceFile } from "@/lib/files-contract";

// Only transport is synthetic; exercise the actual pagination and scope helpers.
const file = (n: number) =>
  ({ workspace_file_id: `file-${n}` }) as WorkspaceFile;
const page = (items: WorkspaceFile[], next_after: string | null) => ({
  data: { items, next_after },
  response: new Response(null, { status: 200 }),
});
beforeEach(() => get.mockReset());

it("discovers files beyond the first 100 using the exact opaque continuation", async () => {
  const first = Array.from({ length: 100 }, (_, i) => file(i));
  get.mockResolvedValueOnce(page(first, "opaque:after-100"));
  get.mockResolvedValueOnce(page([file(100)], null));
  const signal = new AbortController().signal;
  const result = await listFiles("w", "c", signal);
  expect(result.items).toEqual([...first, file(100)]);
  expect(result.next_after).toBeNull();
  expect(get).toHaveBeenCalledTimes(2);
  expect(get.mock.calls[1]?.[1]).toMatchObject({
    params: {
      path: { workspace_id: "w", conversation_id: "c" },
      query: { limit: 100, after: "opaque:after-100" },
    },
    signal,
  });
});

it("does not return a successful partial list when a later page fails", async () => {
  get.mockResolvedValueOnce(page([file(0)], "next"));
  get.mockRejectedValueOnce(new Error("offline"));
  await expect(listFiles("w", "c")).rejects.toMatchObject({
    code: "transport",
  });
});

it("rejects a repeated file continuation instead of looping or claiming completeness", async () => {
  get.mockResolvedValue(page([file(0)], "same"));
  await expect(listFiles("w", "c")).rejects.toThrow(
    "Pagination did not advance",
  );
  expect(get).toHaveBeenCalledTimes(2);
});

it("preserves an empty terminal file list", async () => {
  get.mockResolvedValue(page([], null));
  await expect(listFiles("w", "c")).resolves.toEqual({
    items: [],
    next_after: null,
  });
});

it("propagates cancellation between pages without returning earlier items", async () => {
  get.mockResolvedValueOnce(page([file(0)], "next"));
  get.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
  await expect(
    listFiles("w", "c", new AbortController().signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it("does not publish paginated file metadata after the session scope is fenced", async () => {
  get.mockResolvedValueOnce(page([file(0)], "next"));
  get.mockImplementationOnce(async () => {
    fenceScope();
    return page([file(1)], null);
  });
  await expect(listFiles("w", "c")).rejects.toThrow();
});

it.each([0, -1, 1.5, NaN, Infinity])(
  "rejects invalid concurrency %s immediately",
  (max) => {
    expect(() => limiter(max)).toThrow(RangeError);
  },
);

it("a synchronously throwing read releases its slot for queued work", async () => {
  const run = limiter(1);
  const failed = run(() => {
    throw new Error("sync failure");
  });
  const recovered = run(async () => "next");
  await expect(failed).rejects.toThrow("sync failure");
  await expect(recovered).resolves.toBe("next");
}, 300);

it("bounds concurrency without truncating queued reads, including after rejection", async () => {
  const run = limiter(2);
  let active = 0;
  let peak = 0;
  let started = 0;
  const tasks = Array.from({ length: 25 }, (_, i) =>
    run(async () => {
      started++;
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      if (i === 3) throw new Error("read failed");
      return i;
    }),
  );
  const results = await Promise.allSettled(tasks);
  expect(started).toBe(25);
  expect(peak).toBe(2);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(24);
  expect(results[3]?.status).toBe("rejected");
});

it("fences the whole traversal when scope changes between page callbacks", async () => {
  const { all } = await import("@/lib/client/real-api");
  const fetchPage = vi.fn(async () => {
    queueMicrotask(() => fenceScope());
    return { items: ["old-scope-item"], next_cursor: "next" };
  });
  await expect(all(fetchPage)).rejects.toThrow();
  expect(fetchPage).toHaveBeenCalledTimes(1);
});

it("does not return a terminal page after a traversal-wide scope change", async () => {
  const { all } = await import("@/lib/client/real-api");
  await expect(
    all(async () => {
      queueMicrotask(() => fenceScope());
      return { items: ["old-scope-item"], next_cursor: null };
    }),
  ).rejects.toThrow();
});
