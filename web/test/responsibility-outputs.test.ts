import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/contract/errors";
import {
  mergeOutputReads,
  responsibilityOutputs,
  OUTPUT_READ_LIMIT,
  type OutputRead,
} from "../src/lib/responsibility-outputs";
import { scopedHref } from "../src/lib/scope";

const { transport, prod } = vi.hoisted(() => {
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  return { transport, prod: { get: vi.fn() } };
});
vi.mock("../../contracts/src/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../contracts/src/client")>();
  return {
    ...actual,
    workagentClient: (_base: string, bearer: string, requestId: () => string) =>
      actual.workagentClient(
        "http://responsibility-outputs.test/api/domain",
        bearer,
        requestId,
      ),
  };
});
vi.mock("../src/lib/client/products", () => ({ productApi: prod }));

import { loadOutputReads } from "../src/lib/client/responsibility-outputs";
import { realApi } from "../src/lib/client/real-api";

afterEach(() => {
  transport.mockReset();
  prod.get.mockReset();
});

const ready = (
  cid: string | null,
  title = "Checklist",
  assignment_id: string | null = null,
): OutputRead => ({
  kind: "ready",
  conversation_id: cid,
  assignment_id,
  title,
});

describe("responsibilityOutputs", () => {
  const assignment = { conversation_id: "cv", artifact_ids: ["art"] };

  it("opens a read output at its canonical conversation address", () => {
    const [out] = responsibilityOutputs(assignment, {
      art: ready("cv", "Overnight checklist"),
    });
    expect(out).toEqual({
      id: "art",
      kind: "ready",
      title: "Overnight checklist",
      href: "/conversations/cv/artifacts/art",
      stale: false,
    });
    // The page scopes the link to the workspace the record was opened in.
    expect(scopedHref(out?.kind === "ready" ? out.href : "", "ws-1")).toBe(
      "/conversations/cv/artifacts/art?workspace=ws-1",
    );
  });

  it("links to the artifact's own conversation when it differs from the projection", () => {
    const [out] = responsibilityOutputs(assignment, {
      art: ready("other-cv"),
    });
    expect(out?.kind === "ready" && out.href).toBe(
      "/conversations/other-cv/artifacts/art",
    );
  });

  it("leaves out assignment-owned work the legacy list already shows", () => {
    expect(
      responsibilityOutputs(assignment, {
        art: ready("cv", "Checklist", "asg"),
      }),
    ).toEqual([]);
    expect(responsibilityOutputs(assignment, { art: ready(null) })).toEqual([]);
  });

  it("claims nothing for a denied or failed read, and nothing while loading", () => {
    expect(
      responsibilityOutputs(
        { conversation_id: "cv", artifact_ids: ["a", "b"] },
        { a: { kind: "denied" }, b: { kind: "unknown" } },
      ),
    ).toEqual([
      { id: "a", kind: "denied" },
      { id: "b", kind: "unknown" },
    ]);
    expect(responsibilityOutputs(assignment, {})).toEqual([]);
  });

  it("is empty without a conversation, and offers only the projected link beyond the read bound", () => {
    expect(
      responsibilityOutputs(
        { conversation_id: null, artifact_ids: ["art"] },
        { art: ready("cv") },
      ),
    ).toEqual([]);
    const many = Array.from(
      { length: OUTPUT_READ_LIMIT + 1 },
      (_, i) => `a${i}`,
    );
    const reads = Object.fromEntries(
      many.slice(0, OUTPUT_READ_LIMIT).map((id) => [id, ready("cv")] as const),
    );
    const outs = responsibilityOutputs(
      { conversation_id: "cv", artifact_ids: many },
      reads,
    );
    expect(outs).toHaveLength(OUTPUT_READ_LIMIT + 1);
    expect(outs.at(-1)).toEqual({
      id: `a${OUTPUT_READ_LIMIT}`,
      kind: "unread",
      href: `/conversations/cv/artifacts/a${OUTPUT_READ_LIMIT}`,
    });
  });
});

describe("mergeOutputReads", () => {
  it("keeps an earlier read as stale while a re-read fails, never as current", () => {
    const before = { art: ready("cv", "Checklist") };
    const merged = mergeOutputReads(before, { art: { kind: "unknown" } });
    expect(merged["art"]).toEqual({ ...ready("cv", "Checklist"), stale: true });
  });
  it("lets a definite answer replace what was shown", () => {
    expect(
      mergeOutputReads({ art: ready("cv") }, { art: { kind: "denied" } })[
        "art"
      ],
    ).toEqual({ kind: "denied" });
    expect(mergeOutputReads({}, { art: { kind: "unknown" } })["art"]).toEqual({
      kind: "unknown",
    });
  });
});

describe("loadOutputReads", () => {
  it("reads titles and canonical owners, bounded, and says denied or unknown truthfully", async () => {
    prod.get.mockImplementation(async (_ws: string, id: string) => {
      if (id === "denied")
        throw new ApiError({
          code: "not_found_or_not_authorized",
          status: 404,
          message: "Not found.",
        });
      if (id === "down")
        throw new ApiError({
          code: "transport",
          status: 0,
          message: "Could not reach the local service.",
        });
      return {
        id,
        workspace_id: "w",
        conversation_id: "cv",
        assignment_id: null,
        current_revision_id: "r",
        current_revision: { body: { title: `Title ${id}` } },
      };
    });
    const ids = [
      "ok",
      "denied",
      "down",
      ...Array.from({ length: OUTPUT_READ_LIMIT }, (_, i) => `over${i}`),
    ];
    const reads = await loadOutputReads("w", ids);
    expect(reads["ok"]).toEqual(ready("cv", "Title ok"));
    expect(reads["denied"]).toEqual({ kind: "denied" });
    expect(reads["down"]).toEqual({ kind: "unknown" });
    // Bounded: only the first OUTPUT_READ_LIMIT ids are read at all.
    expect(prod.get).toHaveBeenCalledTimes(OUTPUT_READ_LIMIT);
    expect(Object.keys(reads)).toHaveLength(OUTPUT_READ_LIMIT);
  });
});

// ---- legacy assignment view with a projected conversation-owned id ----

const revision = {
  id: "r1",
  artifact_id: "own-art",
  revision_number: 1,
  parent_revision_id: null,
  author_id: "worker",
  author_kind: "worker",
  body: { title: "Plan", blocks: [] },
  body_hash: "h",
  source_dependencies: [],
};
const routes: Record<string, unknown> = {
  "/v1/workspaces/w/assignments/asg": {
    id: "asg",
    workspace_id: "w",
    owner_id: "o",
    goal: "Carry the overnight checklist forward",
    completion_criteria: ["done"],
    selected_source_refs: [],
    state: "paused",
    work_version: 2,
    conversation_id: "cv",
    artifact_ids: ["conv-art", "own-art"],
    run_ids: [],
    unresolved: [],
  },
  "/v1/workspaces/w/sources": { items: [], next_cursor: null },
  // Canonically conversation-owned: the legacy adapter must not convert it.
  "/v1/workspaces/w/artifacts/conv-art": {
    id: "conv-art",
    workspace_id: "w",
    conversation_id: "cv",
    assignment_id: null,
    current_revision_id: "cr1",
    current_revision: {
      ...revision,
      id: "cr1",
      artifact_id: "conv-art",
      body: { title: "Overnight checklist", blocks: [] },
    },
  },
  "/v1/workspaces/w/artifacts/own-art": {
    id: "own-art",
    workspace_id: "w",
    conversation_id: null,
    assignment_id: "asg",
    current_revision_id: "r1",
    current_revision: revision,
  },
  "/v1/workspaces/w/artifacts/own-art/history": {
    items: [revision],
    next_cursor: null,
  },
  "/v1/workspaces/w/artifacts/own-art/proposals": {
    items: [],
    next_cursor: null,
  },
};

describe("legacy assignment view", () => {
  it("shows assignment-owned work and never fails on a projected conversation-owned id", async () => {
    transport.mockImplementation(async (request: Request) => {
      const path = new URL(request.url).pathname.replace("/api/domain", "");
      const body = routes[path];
      if (!body) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const a = await realApi.getAssignment("w", "asg");
    expect(a.artifacts.map((x) => x.id)).toEqual(["own-art"]);
    expect(a.conversation_id).toBe("cv");
  });
});
