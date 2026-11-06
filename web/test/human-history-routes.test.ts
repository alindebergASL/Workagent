import { beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  Assignment,
  Artifact,
  ConversationDetailView,
} from "../src/lib/contract/types";
import type { WorkspaceScope } from "../src/lib/client/workspace";

// Actual route components + actual owner adapter, pure SSR only. Resource
// scheduling, Next navigation and server authorization are not simulated proof.
const h = vi.hoisted(() => {
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  return {
    params: { id: "assignment", artifactId: "art-236" },
    offset: 0,
    artifact: null as Artifact | null,
    denied: false,
    navigation: null as null | { next: () => void; first: () => void },
    resource: vi.fn(),
    transport,
  };
});
vi.mock("../../contracts/src/client", async (original) => {
  const actual = await original<typeof import("../../contracts/src/client")>();
  return {
    ...actual,
    workagentClient: (_base: string, bearer: string, rid: () => string) =>
      actual.workagentClient("http://history.test/api/domain", bearer, rid),
  };
});
vi.mock("next/navigation", () => ({
  useParams: () => h.params,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("../src/components/ScopedRecord", () => ({
  ScopedRecord: ({
    children,
  }: {
    children: (scope: WorkspaceScope) => ReactNode;
  }) => children({ wsId: "ws", zone: "UTC" } as WorkspaceScope),
  backTo: () => ({ href: "/", label: "Back" }),
}));
vi.mock("../src/lib/client/hooks", () => ({ useResource: h.resource }));
vi.mock("../src/lib/client/responsibility", () => ({
  useResponsibility: () => ({
    state: {
      kind: "ready",
      detail: {
        assignment: {
          conversation_id: "cv",
          artifact_ids: [],
          goal: "Human goal",
          completion_criteria: [],
        },
        lifecycle: {
          state: "cancelled",
          current_outcome: "Saved",
          next_action: { kind: "continue_work", description: "Continue" },
          execution_status: "settled",
        },
      },
    },
    refresh: vi.fn(),
  }),
}));
vi.mock("../src/components/ResponsibilityPanel", () => ({
  ResponsibilityPanel: () => null,
}));
vi.mock("../src/components/Ownership", () => ({ Ownership: () => null }));
vi.mock("../src/components/SourcesDrawer", () => ({
  SourcesDrawer: () => null,
}));
vi.mock("../src/components/HistoryDrawer", () => ({
  HistoryDrawer: () => null,
}));
vi.mock("../src/lib/client/discovery-page", () => ({
  useDiscoveryPage: () => {
    const items = Array.from(
      { length: Math.min(25, 237 - h.offset) },
      (_, n) => {
        const i = h.offset + n;
        return {
          artifact_id: `art-${i}`,
          revision_id: `revision-${i}`,
          title: `Human saved ${i}`,
          assignment_id: i >= 137 ? "assignment" : null,
          conversation_id: i < 137 ? "cv" : null,
        };
      },
    );
    return {
      page: h.denied ? null : { items, has_more: h.offset + 25 < 237 },
      loading: false,
      unavailable: h.denied,
      hasPrevious: h.offset > 0,
      next: () => {
        h.offset += 25;
      },
      first: () => {
        h.offset = 0;
      },
      refresh: vi.fn(),
    };
  },
}));
vi.mock("../src/components/HumanHistory", async (original) => {
  const actual =
    await original<typeof import("../src/components/HumanHistory")>();
  return {
    ...actual,
    HistoryNavigation: (
      props: Parameters<typeof actual.HistoryNavigation>[0],
    ) => {
      h.navigation = props;
      return actual.HistoryNavigation(props);
    },
  };
});
import AssignmentPage from "../src/app/assignments/[id]/page";
import ArtifactPage from "../src/app/assignments/[id]/artifacts/[artifactId]/page";
import ProductPage from "../src/app/conversations/[id]/artifacts/[artifactId]/page";
import { realApi, conversationApi } from "../src/lib/client/real-api";
import {
  __resetScopeForTests,
  bindMockIdentity,
} from "../src/lib/client/session-scope";

const assignment = {
  id: "assignment",
  workspace_id: "ws",
  title: "Saved assignment",
  goal: "Human goal",
  state: "stopped",
  lifecycle: "paused",
  conversation_id: "cv",
  artifacts: [],
  completion_criteria: [],
  selected_source_refs: [],
  activity: [],
  unresolved: [],
  recommendation: null,
  run: null,
  needs_review_artifact_ids: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  observed_at: "2026-01-01T00:00:00Z",
  work_revision: 1,
  stage: null,
  latest_result: null,
  next_step: null,
  selected_source_count: 0,
} satisfies Assignment;

beforeEach(() => {
  vi.restoreAllMocks();
  h.offset = 0;
  h.denied = false;
  h.artifact = null;
  h.navigation = null;
  h.params = { id: "assignment", artifactId: "art-236" };
  h.transport.mockReset();
  __resetScopeForTests();
  bindMockIdentity();
  // The page also reads the work snapshot for the latest note's time; here
  // it's still loading, so the note keeps the record's text with no time.
  h.resource.mockReset().mockImplementation((key: string | null) => ({
    data: key?.startsWith("work-snapshot:")
      ? null
      : key?.startsWith("artifact:")
        ? h.artifact
        : key?.startsWith("history:")
          ? { revisions: [], proposals: [] }
          : assignment,
    loading: false,
    error: null,
    refresh: vi.fn(),
    current: true,
  }));
});

it("the actual conversation destination loader accepts only its canonical owner", async () => {
  h.params = { id: "cv", artifactId: "art-136" };
  h.resource.mockImplementation(() => ({
    data: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }));
  const raw = {
    id: "art-136",
    assignment_id: null,
    conversation_id: "cv",
    workspace_id: "ws",
    current_revision_id: "human-revision",
    current_revision: {
      id: "human-revision",
      author_kind: "human",
      body_hash: "0".repeat(64),
      body: { kind: "file", title: "Conversation saved title" },
    },
  };
  const before = JSON.stringify(raw);
  vi.spyOn(conversationApi, "get").mockResolvedValue({
    conversation: { work_version: 1, state: "open" },
    messages: [],
  } as unknown as ConversationDetailView);
  h.transport.mockImplementation((request: Request) => {
    expect(request.method).toBe("GET");
    const body = new URL(request.url).pathname.endsWith("/artifacts/art-136")
      ? raw
      : { items: [], next_cursor: null };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  renderToStaticMarkup(createElement(ProductPage));
  const loader = h.resource.mock.calls.find(
    ([key]) => key === "product:ws:cv:art-136",
  )?.[1];
  const result = await loader(new AbortController().signal);
  expect(result.artifact.current_revision.body.title).toBe(
    "Conversation saved title",
  );
  expect(result.artifact.conversation_id).toBe("cv");
  expect(JSON.stringify(raw)).toBe(before);
  raw.conversation_id = "other-conversation";
  await expect(loader(new AbortController().signal)).rejects.toMatchObject({
    code: "not_found_or_not_authorized",
  });
});

it("the actual responsibility route renders every mixed-owner page, including displaced originals", () => {
  const seen: string[] = [];
  while (h.offset < 237) {
    const html = renderToStaticMarkup(createElement(AssignmentPage));
    const section =
      html
        .split('data-testid="responsibility-outputs"')[1]
        ?.split("</ul>")[0] ?? "";
    const links = [...section.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    const expected = Array.from(
      { length: Math.min(25, 237 - h.offset) },
      (_, n) => {
        const i = h.offset + n;
        return `/${i < 137 ? "conversations/cv" : "assignments/assignment"}/artifacts/art-${i}?workspace=ws`;
      },
    );
    expect(links).toEqual(expected);
    seen.push(...links);
    expect(html.includes("Next page")).toBe(h.offset + 25 < 237);
    h.navigation!.next();
  }
  expect(new Set(seen).size).toBe(237);
  h.navigation!.first();
  expect(h.offset).toBe(0);
  h.denied = true;
  const denied = renderToStaticMarkup(createElement(AssignmentPage));
  expect(denied).not.toContain("Human saved");
  expect(denied).not.toContain('data-testid="responsibility-outputs"');
  expect(denied).toContain("could not be confirmed");
});

it("the actual assignment artifact adapter and destination route read a displaced original directly", async () => {
  const revision = {
    id: "human-revision",
    artifact_id: "art-236",
    parent_revision_id: null,
    revision_number: 2,
    author_kind: "human",
    author_id: "human",
    created_at: "2026-01-01T00:00:00Z",
    body: {
      title: "Current human title",
      blocks: [
        { id: "note", kind: "paragraph", text: "Human edit kept verbatim" },
      ],
    },
    body_hash: "0".repeat(64),
    source_dependencies: [],
    note: null,
  };
  const raw = {
    id: "art-236",
    assignment_id: "assignment",
    conversation_id: null,
    workspace_id: "ws",
    current_revision_id: revision.id,
    current_revision: revision,
  };
  const before = JSON.stringify(raw);
  h.transport.mockImplementation((request: Request) => {
    expect(request.method).toBe("GET");
    expect(request.headers.get("x-workagent-scope")).toBe("0".repeat(64));
    const path = new URL(request.url).pathname;
    const body = path.endsWith("/artifacts/art-236")
      ? raw
      : path.endsWith("/assignments/assignment")
        ? {
            ...assignment,
            // Compatibility summary names only conversation products, not this original.
            artifact_ids: Array.from({ length: 100 }, (_, i) => `art-${i}`),
            run_ids: [],
          }
        : { items: [], next_cursor: null };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  h.artifact = await realApi.getArtifact("ws", "art-236");
  h.resource.mockImplementation((key: string | null) => ({
    data: key?.startsWith("assignment-artifact:")
      ? raw
      : key?.startsWith("artifact:")
        ? h.artifact
        : key?.startsWith("history:")
          ? { revisions: [], proposals: [] }
          : assignment,
    loading: false,
    error: null,
    refresh: vi.fn(),
    current: true,
  }));
  expect(h.artifact.assignment_id).toBe("assignment");
  expect(h.artifact.accepted_revision?.author.kind).toBe("human");
  expect(h.artifact.approved_revision_id).toBeNull(); // a human save is not invented acceptance
  const html = renderToStaticMarkup(createElement(ArtifactPage));
  expect(html).toContain("Current human title");
  expect(html).toContain("Human edit kept verbatim");
  expect(html).toContain("/assignments/assignment?workspace=ws");
  const loader = h.resource.mock.calls.find(
    ([key]) => key === "artifact:ws:art-236:current",
  )?.[1];
  await loader(new AbortController().signal);
  expect(JSON.stringify(raw)).toBe(before);
  h.transport.mockResolvedValue(
    new Response(JSON.stringify({ code: "not_found_or_not_authorized" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }),
  );
  await expect(realApi.getArtifact("ws", "art-236")).rejects.toMatchObject({
    code: "not_found_or_not_authorized",
  });
});
