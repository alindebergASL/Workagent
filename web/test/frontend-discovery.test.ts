import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/client/real-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client/real-api")>();
  return { ...actual, client: { ...actual.client, GET: get } };
});
import {
  holdRefs,
  loadHolds,
  type HoldEntry,
} from "@/lib/client/responsibility";
import { fenceScope } from "@/lib/client/session-scope";
import { listMemory } from "@/lib/client/memory";
import { MemoryReadFence, loadEvidence } from "@/lib/client/memory-reads";
import { EvidencePicker, MemoryPanel } from "@/components/MemoryPanel";
import { filenameProblem, MAX_FILENAME_LENGTH } from "@/lib/files-contract";
import type { ProcedureEvidencePage } from "@/lib/memory-contract";

const page = (data: unknown) => ({
  data,
  response: new Response(null, { status: 200 }),
});
const refs = Array.from({ length: 31 }, (_, i) => ({
  ws: `w-${i % 2}`,
  id: `a-${i}`,
}));
beforeEach(() => get.mockReset());

it("reads all 31 holds across spaces, deduplicating without a cardinality cap", async () => {
  let active = 0;
  let peak = 0;
  get.mockImplementation(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 0));
    active--;
    return page({ lifecycle: { state: "open" } });
  });
  const signal = new AbortController().signal;
  const result = await loadHolds([...refs, refs[0]!], {}, signal);
  expect(Object.keys(result)).toHaveLength(31);
  expect(get).toHaveBeenCalledTimes(31);
  expect(peak).toBeLessThanOrEqual(6);
  expect(holdRefs([...refs, refs[0]!])).toHaveLength(31);
  expect(get.mock.calls.map((call) => call[1].params.path)).toEqual(
    holdRefs(refs).map(({ ws, id }) => ({
      workspace_id: ws,
      assignment_id: id,
    })),
  );
});

it.each(["abort", "scope"])(
  "does not start queued holds or publish results after %s",
  async (kind) => {
    const ac = new AbortController();
    get.mockImplementation(async () => {
      if (kind === "abort") ac.abort();
      else fenceScope();
      return page({ lifecycle: { state: "open" } });
    });
    await expect(loadHolds(refs, {}, ac.signal)).rejects.toThrow();
    // Drain the shared queue before the next scope test starts.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(get.mock.calls.length).toBeLessThanOrEqual(6);
  },
);

it("retains failed rereads only as stale or unknown, never turns denial into old ready state", async () => {
  const previous = {
    a: {
      kind: "ready",
      stale: false,
      detail: { lifecycle: { state: "open" } },
    },
    b: { kind: "unknown", lastAbsent: true },
    c: {
      kind: "ready",
      stale: false,
      detail: { lifecycle: { state: "open" } },
    },
  } as unknown as Record<string, HoldEntry>;
  get.mockRejectedValueOnce(new Error("offline"));
  get.mockRejectedValueOnce(new Error("offline"));
  get.mockResolvedValueOnce({
    error: { code: "not_found_or_not_authorized" },
    response: new Response(null, { status: 404 }),
  });
  const result = await loadHolds(
    ["a", "b", "c"].map((id) => ({ ws: "w", id })),
    previous,
    new AbortController().signal,
  );
  expect(result.a).toMatchObject({ kind: "ready", stale: true });
  expect(result.b).toEqual({ kind: "unknown", lastAbsent: true });
  expect(result.c).toEqual({ kind: "denied" });
});

it("uses contracted server search without inventing pagination or losing has_more", async () => {
  const html = renderToStaticMarkup(
    createElement(MemoryPanel, {
      ws: "w",
      cid: "c",
      isWorkArea: true,
      workVersion: 1,
      runId: null,
    }),
  );
  expect(html).toContain("Find memories in this view");
  expect(html).toContain('type="search"');
  expect(html).toContain('maxLength="500"');
  get.mockResolvedValue(page({ items: [], has_more: true }));
  const result = await listMemory(
    "w",
    "c",
    "candidate",
    undefined,
    "rare phrase",
  );
  expect(result.has_more).toBe(true);
  expect(get.mock.calls[0]?.[1].params.query).toEqual({
    conversation_id: "c",
    status: "candidate",
    query: "rare phrase",
  });
  expect(get).toHaveBeenCalledTimes(1);
});

it.each([true, false, null])(
  "preserves evidence completeness %s, including unknown current contract",
  async (more) => {
    const loaded = vi.fn();
    // Intentionally exercise an older server payload without completeness.
    const data = { items: [] } as unknown as ProcedureEvidencePage;
    if (more !== null) data.has_more = more;
    loadEvidence(
      new MemoryReadFence(),
      async () => data,
      {
        loading: vi.fn(),
        loaded,
        failed: vi.fn(),
        denied: vi.fn(),
      },
      String,
    );
    await Promise.resolve();
    expect(loaded).toHaveBeenCalledWith([], more, null);
    const html = renderToStaticMarkup(
      createElement(EvidencePicker, {
        options: [],
        hasMore: more,
        chosen: [],
        disabled: false,
        onToggle: vi.fn(),
        onRetry: vi.fn(),
      }),
    );
    if (more === true) expect(html).toContain("More supporting events exist");
    if (more === null)
      expect(html).toContain(
        "does not report whether more supporting events exist",
      );
    if (more === false) expect(html).not.toContain("continuation");
  },
);

it("drops evidence completeness together with stale payload after authorization revocation", async () => {
  const fence = new MemoryReadFence();
  const loaded = vi.fn();
  let resolve!: (page: ProcedureEvidencePage) => void;
  loadEvidence(
    fence,
    () =>
      new Promise((r) => {
        resolve = r;
      }),
    {
      loading: vi.fn(),
      loaded,
      failed: vi.fn(),
      denied: vi.fn(),
    },
    String,
  );
  fence.revoke();
  resolve({ items: [], has_more: false });
  await Promise.resolve();
  expect(loaded).not.toHaveBeenCalled();
});

it("preserves full long filename input and reports the actual backend total-length bound", () => {
  expect(MAX_FILENAME_LENGTH).toBe(85);
  expect(filenameProblem(`${"a".repeat(76)}.markdown`)).toBeNull();
  for (const suffix of ["json", "markdown"]) {
    const name = `${"a".repeat(81)}.${suffix}`;
    expect(filenameProblem(name)).toContain("including the filename extension");
    expect(filenameProblem(name)).toContain("not been shortened");
  }
  // Source assertion covers the real input, not a lookalike test component.
  const source = readFileSync(
    new URL("../src/components/WorkspaceFiles.tsx", import.meta.url),
    "utf8",
  );
  expect(
    source.match(/<input\s+value=\{filename\}[\s\S]*?\/>/)?.[0],
  ).not.toContain("maxLength");
  const backend = readFileSync(
    new URL(
      "../../backend/workagent/workspace_file_models.py",
      import.meta.url,
    ),
    "utf8",
  );
  expect(backend).toContain("Filename = Annotated[str, Field(max_length=85,");
});

it("has no inert Settings navigation placeholder in the current shell", () => {
  const shell = readFileSync(
    new URL("../src/components/Shell.tsx", import.meta.url),
    "utf8",
  );
  expect(shell).not.toContain("nav-placeholder");
  expect(shell).not.toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?Settings/);
});
