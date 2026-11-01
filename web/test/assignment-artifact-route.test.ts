import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkspaceScope } from "../src/lib/client/workspace";
import { ApiError } from "../src/lib/contract/errors";
const h = vi.hoisted(() => {
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  return { transport, resource: vi.fn(), revision: "" };
});
vi.mock("../../contracts/src/client", async (original) => {
  const actual = await original<typeof import("../../contracts/src/client")>();
  return {
    ...actual,
    workagentClient: (_base: string, bearer: string, rid: () => string) =>
      actual.workagentClient("http://assignment.test/api/domain", bearer, rid),
  };
});
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "assignment", artifactId: "art" }),
  useSearchParams: () =>
    new URLSearchParams(h.revision ? { revision_id: h.revision } : {}),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("../src/components/ScopedRecord", () => ({
  ScopedRecord: ({
    children,
  }: {
    children: (scope: WorkspaceScope) => ReactNode;
  }) => children({ wsId: "ws", zone: "UTC" } as WorkspaceScope),
}));
vi.mock("../src/lib/client/hooks", () => ({ useResource: h.resource }));
import Page from "../src/app/assignments/[id]/artifacts/[artifactId]/page";
import { loadAssignmentArtifact } from "../src/components/AssignmentArtifactRoute";
import {
  __resetScopeForTests,
  bindMockIdentity,
} from "../src/lib/client/session-scope";
const original = {
  id: "original",
  artifact_id: "art",
  revision_number: 1,
  parent_revision_id: null,
  author_kind: "worker",
  body: {
    kind: "table",
    title: "Original title",
    columns: ["value"],
    rows: [{ value: "original cell" }],
    notes: ["original note"],
  },
};
const current = {
  ...original,
  id: "human",
  revision_number: 2,
  author_kind: "human",
  body: {
    ...original.body,
    title: "Human title",
    rows: [{ value: "human cell" }],
    notes: ["human note kept"],
  },
};
const raw = () => ({
  id: "art",
  workspace_id: "ws",
  assignment_id: "assignment",
  conversation_id: null,
  current_revision_id: "human",
  current_revision: structuredClone(current),
  requested_revision: null as typeof original | null,
});
beforeEach(() => {
  h.transport.mockReset();
  h.resource.mockReset();
  h.revision = "";
  __resetScopeForTests();
  bindMockIdentity();
});
function loaded(artifact = raw(), error: ApiError | null = null) {
  h.resource.mockImplementation((key: string | null) => ({
    data: key?.startsWith("assignment-artifact:")
      ? error
        ? null
        : artifact
      : [original, current],
    error: key?.startsWith("assignment-artifact:") ? error : null,
    refresh: vi.fn(),
    current: !error,
  }));
}
it("the actual route renders assignment tables and exact human notes, not the document adapter", () => {
  loaded();
  const html = renderToStaticMarkup(createElement(Page));
  expect(html).toContain("Human title");
  expect(html).toContain("human cell");
  expect(html).toContain("human note kept");
  expect(html).toContain("Saved by you");
  expect(html).toContain("Read-only saved output");
  expect(html).not.toContain("Open this product from its conversation");
  expect(html).not.toContain("/conversations/");
  expect(
    h.resource.mock.calls.some(([key]) => key?.startsWith("artifact:")),
  ).toBe(false);
});
it("renders the requested original separately without moving the current revision", () => {
  const artifact = raw();
  artifact.requested_revision = structuredClone(original);
  h.revision = "original";
  loaded(artifact);
  const before = JSON.stringify(artifact);
  const html = renderToStaticMarkup(createElement(Page));
  expect(html).toContain("original cell");
  expect(html).toContain("original note");
  expect(html).not.toContain("human cell");
  expect(html).toContain("Show current version");
  expect(JSON.stringify(artifact)).toBe(before);
});
it.each(["not_found_or_not_authorized", "unauthenticated"] as const)(
  "does not render saved bodies after %s",
  (code) => {
    loaded(
      raw(),
      new ApiError({ code, status: 404, message: "Not available" }),
    );
    const html = renderToStaticMarkup(createElement(Page));
    expect(html).not.toContain("human cell");
    expect(html).not.toContain("Human title");
    expect(html).not.toContain("human note kept");
  },
);
it("uses an authenticated exact revision GET and preserves bytes", async () => {
  const artifact = raw();
  artifact.requested_revision = structuredClone(original);
  const before = JSON.stringify(artifact);
  h.transport.mockImplementation((request: Request) => {
    expect(request.method).toBe("GET");
    expect(new URL(request.url).searchParams.get("revision_id")).toBe(
      "original",
    );
    expect(request.headers.get("x-workagent-scope")).toBe("0".repeat(64));
    return Promise.resolve(
      new Response(before, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  expect(
    await loadAssignmentArtifact(
      "ws",
      "assignment",
      "art",
      "original",
      new AbortController().signal,
    ),
  ).toEqual(artifact);
  expect(JSON.stringify(artifact)).toBe(before);
});
it.each([
  { assignment_id: "other" },
  { conversation_id: "conversation" },
  { workspace_id: "other" },
  { id: "other" },
])("rejects a URL-owner mismatch %j", async (changed) => {
  h.transport.mockResolvedValue(
    new Response(JSON.stringify({ ...raw(), ...changed }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  await expect(
    loadAssignmentArtifact(
      "ws",
      "assignment",
      "art",
      null,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "not_found_or_not_authorized" });
});
it("does not show a previous URL's retained resource during navigation", () => {
  const artifact = raw();
  artifact.assignment_id = "different-owner";
  loaded(artifact);
  let html = renderToStaticMarkup(createElement(Page));
  expect(html).not.toContain("human cell");
  expect(html).not.toContain("Human title");
  loaded();
  h.revision = "original";
  html = renderToStaticMarkup(createElement(Page));
  expect(html).not.toContain("human cell");
  expect(html).not.toContain("Human title");
});
it("propagates API denial rather than falling back to an assignment summary", async () => {
  h.transport.mockResolvedValue(
    new Response(JSON.stringify({ code: "not_found_or_not_authorized" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }),
  );
  await expect(
    loadAssignmentArtifact(
      "ws",
      "assignment",
      "art",
      null,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "not_found_or_not_authorized" });
  expect(h.transport).toHaveBeenCalledTimes(1);
});
