import { beforeEach, expect, it, vi } from "vitest";
import { createElement, Children, isValidElement, type ReactNode } from "react";
import { MemoryDiscovery } from "@/components/MemoryDiscovery";
import type { HumanMemorySummary } from "@/lib/memory-contract";
import { renderToStaticMarkup } from "react-dom/server";
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/client/real-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client/real-api")>();
  return { ...actual, client: { ...actual.client, GET: get } };
});
import {
  discoverMemory,
  readDiscoveredMemory,
  lessonEvidence,
  readLessonEvidence,
} from "@/lib/client/memory";
import { MemoryReadFence, loadEvidence } from "@/lib/client/memory-reads";
import { EvidencePicker } from "@/components/MemoryPanel";
import type {
  ProcedureEvidenceOption,
  ProcedureEvidencePage,
} from "@/lib/memory-contract";

const response = (data: unknown) => ({
  data,
  response: new Response(null, { status: 200 }),
});
beforeEach(() => {
  get.mockReset();
});

it("traverses human summary pages without falling back to the packed recall route", async () => {
  const ids = Array.from({ length: 65 }, (_, i) => `m-${i}`);
  get.mockImplementation(async (_path, request) => {
    if (!request) throw new Error(`Unexpected path: ${_path}`);
    const offset = Number(request.params.query.cursor ?? 0);
    const items = ids
      .slice(offset, offset + 20)
      .map((memory_id) => ({ memory_id }));
    return response({
      items,
      has_more: offset + 20 < ids.length,
      next_cursor: offset + 20 < ids.length ? String(offset + 20) : null,
    });
  });
  const found: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await discoverMemory(
      "ws",
      "cv",
      "candidate",
      undefined,
      "needle",
      cursor,
    );
    found.push(...(page.items ?? []).map((i) => i.memory_id));
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  expect(found).toEqual(ids);
  for (const [path, request] of get.mock.calls) {
    expect(path).toBe("/v1/workspaces/{workspace_id}/memory/discovery");
    expect(request.params.query).toMatchObject({
      conversation_id: "cv",
      status: "candidate",
      query: "needle",
      limit: 20,
    });
  }
});

it("opens full memory by exact listed revision and conversation, not an unscoped cached body", async () => {
  const full = {
    revision: { content: "x".repeat(6001) },
    unresolved_conflict: true,
  };
  get.mockResolvedValue(response(full));
  const result = await readDiscoveredMemory("ws", "cv", "m", "r", "candidate");
  expect(result).toBe(full);
  expect(get.mock.calls[0]?.[0]).toBe(
    "/v1/workspaces/{workspace_id}/memory/discovery/{memory_id}",
  );
  expect(get.mock.calls[0]?.[1].params.query).toEqual({
    conversation_id: "cv",
    revision_id: "r",
    status: "candidate",
  });
  get.mockResolvedValue({
    error: { code: "not_found_or_not_authorized" },
    response: new Response(null, { status: 404 }),
  });
  await expect(
    readDiscoveredMemory("ws", "cv", "m", "r"),
  ).rejects.toMatchObject({ code: "not_found_or_not_authorized" });
});

it("actual summary UI exposes every page member, preserves dispute labels and opens the exact revision", () => {
  const summary: HumanMemorySummary = {
    memory_id: "m-13",
    revision_id: "r-13",
    kind: "fact",
    scope_kind: "task",
    subject_key: "shared",
    predicate_key: "value",
    status: "contested",
    excerpt: "Bounded preview",
    unresolved_conflict: true,
    contradiction_group_id: "group",
  };
  const onOpen = vi.fn();
  const tree = MemoryDiscovery({ items: [summary], disabled: false, onOpen });
  const html = renderToStaticMarkup(tree);
  expect(html).toContain("Bounded preview");
  expect(html).toContain(
    "Unresolved conflict; other members may be on another page",
  );
  expect(html).toContain("Open full memory");
  function activate(node: ReactNode) {
    Children.forEach(node, (child) => {
      if (
        !isValidElement<{ children?: ReactNode; onClick?: () => void }>(child)
      )
        return;
      if (child.type === "button") child.props.onClick?.();
      else activate(child.props.children);
    });
  }
  activate(tree);
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(summary);
  expect(
    renderToStaticMarkup(
      createElement(MemoryDiscovery, {
        items: [summary],
        disabled: true,
        onOpen,
      }),
    ),
  ).toContain('disabled=""');
  expect(MemoryDiscovery({ items: [], disabled: false, onOpen })).toBeNull();
});

const option: ProcedureEvidenceOption = {
  evidence: {
    kind: "tool_observation",
    conversation_id: "cv",
    event_id: "e-51",
    sha256: "a".repeat(64),
  },
  label: "Failed observation",
  outcome: "outcome_unknown",
  operational_outcome: "failed",
  observed_at: "2026-01-01T00:00:00Z",
};

it("passes evidence continuation and exact full-event hash through generated routes", async () => {
  get.mockResolvedValue(
    response({ items: [option], has_more: false, next_cursor: null }),
  );
  await lessonEvidence("ws", "cv", undefined, "tool_observation:e-50");
  expect(get.mock.calls[0]?.[1].params.query).toEqual({
    conversation_id: "cv",
    cursor: "tool_observation:e-50",
    limit: 50,
  });
  get.mockResolvedValue(
    response({
      evidence: option.evidence,
      data: { status: "outcome_unknown" },
    }),
  );
  const detail = await readLessonEvidence("ws", option.evidence);
  expect(detail.data.status).toBe("outcome_unknown");
  expect(get.mock.calls[1]?.[0]).toBe(
    "/v1/workspaces/{workspace_id}/memory/lesson-evidence/{kind}/{event_id}",
  );
  expect(get.mock.calls[1]?.[1].params.query).toEqual({
    conversation_id: "cv",
    sha256: "a".repeat(64),
  });
});

it("fences next-page metadata and labels together after denial or replacement", async () => {
  const fence = new MemoryReadFence();
  const loaded = vi.fn();
  let finish!: (page: ProcedureEvidencePage) => void;
  loadEvidence(
    fence,
    () =>
      new Promise((resolve) => {
        finish = resolve;
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
  finish({
    items: [option],
    has_more: true,
    next_cursor: "tool_observation:e-51",
  });
  await Promise.resolve();
  expect(loaded).not.toHaveBeenCalled();
  loadEvidence(
    fence,
    async () => ({
      items: [option],
      has_more: true,
      next_cursor: "tool_observation:e-51",
    }),
    {
      loading: vi.fn(),
      loaded,
      failed: vi.fn(),
      denied: vi.fn(),
    },
    String,
  );
  await Promise.resolve();
  expect(loaded).toHaveBeenCalledWith([option], true, "tool_observation:e-51");
});

it("real chooser exposes next/full-event actions without upgrading failed or unknown evidence", () => {
  const html = renderToStaticMarkup(
    createElement(EvidencePicker, {
      options: [option],
      hasMore: true,
      chosen: [option.evidence],
      disabled: false,
      onToggle: vi.fn(),
      onRetry: vi.fn(),
      onNext: vi.fn(),
      onInspect: vi.fn(),
    }),
  );
  expect(html).toContain("Next supporting events");
  expect(html).toContain("Read full event");
  expect(html).toContain("Refresh supporting events from start");
  expect(html).toContain("checked again when saving");
  expect(html).toContain('data-outcome="failed"');
  expect(html).not.toContain("does not provide continuation");
});
