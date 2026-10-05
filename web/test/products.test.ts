import { describe, expect, it, vi, afterEach } from "vitest";
import {
  currentObservation,
  resolveObservations,
  productApi,
  formInputs,
  attachment,
  type S,
} from "../src/lib/client/products";
import {
  conversationApi,
  conversationDetail,
} from "../src/lib/client/real-api";
import examples from "../../contracts/examples.json";
import { GET } from "../src/app/api/domain/[...path]/route";
import { NextRequest } from "next/server";

const { transport } = vi.hoisted(() => {
  const transport = vi.fn();
  vi.stubGlobal("fetch", transport);
  return { transport };
});
vi.mock("../../contracts/src/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../contracts/src/client")>();
  return {
    ...actual,
    workagentClient: (_base: string, bearer: string, requestId: () => string) =>
      actual.workagentClient(
        "http://products.test/api/domain",
        bearer,
        requestId,
      ),
  };
});

const hash = "0".repeat(64);
const artifact: S["Artifact"] = {
  id: "a",
  workspace_id: "w",
  conversation_id: "c",
  assignment_id: null,
  current_revision_id: "r",
  current_revision: {
    id: "r",
    artifact_id: "a",
    revision_number: 1,
    parent_revision_id: null,
    author_id: "worker",
    author_kind: "worker",
    body: {
      kind: "file",
      title: "test",
      filename: "test.txt",
      mime_type: "text/plain",
      content: "x",
      content_sha256: hash,
    },
    body_hash: hash,
    source_dependencies: [],
  },
};
const observation: S["ObservationReadback"] = {
  binding_state: "current_revision",
  current_scope: true,
  observation: {
    id: "o",
    artifact_id: "a",
    workspace_id: "w",
    conversation_id: "c",
    run_id: "run",
    revision_id: "r",
    proposal_id: null,
    body_hash: hash,
    operation_hash: hash,
    access_generation: 1,
    evidence_origin: "controlled_transport",
    output: {
      kind: "run_wasm",
      value: "3750",
      arguments: [3, 1250],
      entrypoint: "total",
      code_sha256: hash,
      input_sha256: hash,
      engine: "wasmtime-49.0.0",
      execution_observed: true,
      fuel_consumed: 3,
      fuel_limit: 50000,
      memory_limit_bytes: 1048576,
      host_imports: 0,
    },
  },
};

describe("product integration boundaries", () => {
  it("replays the identical HTTP body after reloading the API module and its command cache", async () => {
    const payload = {
      command_id: "stable-operation-command",
      request_id: "stable-operation-request",
      expected_work_version: 7,
      text: "Exact attached operation",
      operation: {
        kind: "reconcile_csv" as const,
        input_csv: "exact\r\nCSV bytes",
        rounding: "ROUND_HALF_UP" as const,
      },
    };
    const requests: string[] = [];
    transport.mockImplementation(async (request: Request) => {
      requests.push(await request.text());
      throw new TypeError("Synthetic acknowledgement lost");
    });
    await expect(conversationApi.send("w", "c", payload)).rejects.toMatchObject(
      { code: "transport" },
    );
    vi.stubGlobal("fetch", transport);
    vi.resetModules();
    const reloaded = await import("../src/lib/client/real-api");
    await expect(
      reloaded.conversationApi.send(
        "w",
        "c",
        JSON.parse(JSON.stringify(payload)),
      ),
    ).rejects.toMatchObject({ code: "transport" });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
    expect(JSON.parse(requests[0]!)).toEqual({
      schema_version: "workagent/v1",
      ...payload,
    });
  });
  it.each([
    "1000000000000000001",
    "-1000000000000000001",
    "9223372036854775807",
    "-9223372036854775808",
  ])(
    "keeps signed i64 observation %s exact through HTTP JSON readback",
    async (value) => {
      const read = structuredClone(observation);
      if (read.observation.output.kind !== "run_wasm")
        throw new Error("fixture");
      read.observation.output.value = value;
      transport.mockResolvedValue(new Response(JSON.stringify(read)));
      const result = await productApi.observe("w", "o");
      expect(result.observation.output).toMatchObject({ value });
    },
  );
  it.each(["pending_proposal", "historical"] as const)(
    "finds saved verification independently of latest %s observation",
    async (binding_state) => {
      const later = { ...structuredClone(observation), binding_state };
      later.observation.id = "later";
      later.observation.revision_id = null;
      later.observation.proposal_id = "proposal";
      const read = vi.fn(async (id: string) =>
        id === "later" ? later : observation,
      );
      const result = await resolveObservations(
        artifact,
        [
          {
            kind: "tool",
            artifact_id: "a",
            observation_id: "o",
            revision_id: "r",
          },
          {
            kind: "tool",
            artifact_id: "a",
            observation_id: "later",
            proposal_id: "proposal",
          },
        ],
        read,
      );
      expect(result.current).toEqual(observation);
      expect(result.latest).toEqual(later);
      expect(currentObservation(artifact, result.current)).toBe(true);
      expect(currentObservation(artifact, result.latest)).toBe(false);
    },
  );
  it("paginates every proposal and history entry, sorting revisions numerically rather than by UUID", async () => {
    const revisions = Array.from({ length: 102 }, (_, i) => ({
      ...artifact.current_revision,
      id: `r-${i}`,
      revision_number: 102 - i,
    }));
    const proposals = Array.from({ length: 102 }, (_, i) => ({ id: `p-${i}` }));
    const calls: string[] = [];
    transport.mockImplementation(async (request: Request) => {
      const url = new URL(request.url);
      calls.push(url.pathname + url.search);
      const entries = url.pathname.endsWith("history") ? revisions : proposals;
      const page = url.searchParams.has("cursor")
        ? { items: entries.slice(100), next_cursor: null }
        : { items: entries.slice(0, 100), next_cursor: "next" };
      return new Response(JSON.stringify(page));
    });
    const history = await productApi.history("w", "a");
    expect(history).toHaveLength(102);
    expect(history.map((r) => r.revision_number)).toEqual(
      Array.from({ length: 102 }, (_, i) => i + 1),
    );
    expect(await productApi.proposals("w", "a")).toHaveLength(102);
    expect(calls.filter((c) => c.includes("cursor=next"))).toHaveLength(2);
  });
  it("requires exact identity, hash, binding and scope for current verification", () => {
    expect(currentObservation(artifact, observation)).toBe(true);
    expect(currentObservation(artifact, null)).toBe(false);
    expect(
      currentObservation(artifact, { ...observation, current_scope: false }),
    ).toBe(false);
    expect(
      currentObservation(artifact, {
        ...observation,
        binding_state: "historical",
      }),
    ).toBe(false);
    expect(
      currentObservation(artifact, {
        ...observation,
        binding_state: "pending_proposal",
      }),
    ).toBe(false);
    for (const change of [
      { artifact_id: "else" },
      { workspace_id: "else" },
      { conversation_id: "else" },
      { body_hash: "1".repeat(64) },
      { revision_id: "old" },
    ])
      expect(
        currentObservation(artifact, {
          ...observation,
          observation: { ...observation.observation, ...change },
        }),
      ).toBe(false);
  });
  it("preserves authoritative unavailable/failed reason instead of guessing from queued", () => {
    const d = structuredClone(
      examples.operations.get_conversation.response,
    ) as Parameters<typeof conversationDetail>[0];
    d.turns = [
      {
        run_id: d.runs[0]!.id,
        state: "unavailable",
        reason: "Consumer has not claimed the turn",
        evidence_origin: "controlled_transport",
        provider_observation: "not_observed",
      },
    ];
    expect(conversationDetail(d).turns[0]).toMatchObject({
      state: "unavailable",
      reason: "Consumer has not claimed the turn",
    });
    d.turns[0]!.state = "failed";
    expect(conversationDetail(d).turns[0]!.state).toBe("failed");
  });
  it("exposes generated product references and list preview without turning them into document blocks", () => {
    const d = structuredClone(
      examples.operations.get_conversation.response,
    ) as Parameters<typeof conversationDetail>[0];
    d.conversation.last_message_preview = "CSV computed";
    d.conversation.updated_at = "2026-10-03T00:00:00Z";
    d.messages[0]!.result = {
      results: [
        {
          kind: "table",
          artifact_id: "a",
          revision_id: "r",
          observation_id: "o",
        },
      ],
    };
    const v = conversationDetail(d);
    expect(v.messages[0]!.products?.[0]?.artifact_id).toBe("a");
    expect(v.conversation.last_message_preview).toBe("CSV computed");
  });
  it("accepts bounded explicit integer form inputs and rejects ambiguous numeric text", () => {
    expect(
      formInputs("3,1250,500", "Quantity,Price,Shipping").arguments,
    ).toEqual([3, 1250, 500]);
    for (const text of ["1e3", "1.2", "true", "1000000001", "", "1,2"])
      expect(() => formInputs(text, "Input")).toThrow();
    expect(() => formInputs("1,2", "a,")).toThrow();
  });
  it("rejects oversized and non-UTF8 attachments before admission", async () => {
    await expect(
      attachment(new File([new Uint8Array(16001)], "big.wat"), "run_wasm"),
    ).rejects.toThrow();
    await expect(
      attachment(new File([new Uint8Array([255])], "bad.csv"), "reconcile_csv"),
    ).rejects.toThrow();
    await expect(
      attachment(new File(["hello"], "safe.csv"), "reconcile_csv"),
    ).resolves.toBe("hello");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("same-origin download proxy", () => {
  const request = () =>
    new NextRequest(
      "http://127.0.0.1:3000/api/domain/v1/workspaces/w/artifacts/a/download",
      { headers: { host: "127.0.0.1:3000", "x-workagent-client": "local-ui" } },
    );
  const params = {
    params: Promise.resolve({
      path: ["v1", "workspaces", "w", "artifacts", "a", "download"],
    }),
  };
  function setup(type: string, name: string, digest = hash) {
    vi.stubEnv("LOCAL_TEST_MODE", "true");
    vi.stubEnv(
      "LOCAL_BEARER_TOKEN",
      "synthetic-test-bearer-not-a-secret".padEnd(40, "x"),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("(module)", {
          headers: {
            "content-type": type,
            "content-disposition": name,
            "x-content-sha256": digest,
          },
        }),
      ),
    );
  }
  it("forwards safe file bytes and digest instead of labelling WAT JSON", async () => {
    setup("application/wasm-text", 'attachment; filename="invoice-tool.wat"');
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/wasm-text");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-content-sha256")).toBe(hash);
    expect(await response.text()).toBe("(module)");
  });
  it("rejects unsafe filenames, MIME and missing digests", async () => {
    for (const [type, name, digest] of [
      ["text/html", 'attachment; filename="x.wat"', hash],
      ["text/csv", 'attachment; filename="../x.csv"', hash],
      ["text/csv", 'attachment; filename="x.csv"', ""],
    ]) {
      setup(type!, name!, digest);
      expect((await GET(request(), params)).status).toBe(502);
    }
  });
  it("does not give unauthenticated navigation a bearer-backed download", async () => {
    setup("text/csv", 'attachment; filename="x.csv"');
    const response = await GET(
      new NextRequest(
        "http://127.0.0.1:3000/api/domain/v1/workspaces/w/artifacts/a/download",
        { headers: { host: "127.0.0.1:3000" } },
      ),
      params,
    );
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
