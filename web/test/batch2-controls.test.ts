import { beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  commandBody,
  documentApi,
  postMessageBody,
  queueApi,
  runApi,
  setFetch,
  type UploadBody,
} from "@/lib/client/batch2-api";
import {
  newEntry,
  stageBytes,
  uploadAll,
  uploadStaged,
  type StagedEntry,
} from "@/lib/client/documents";
import { ApiError } from "@/lib/contract/errors";
import type {
  DocumentDetail,
  QueuedMessage,
  RunCheckpoint,
} from "@/lib/contract/batch2";
import {
  continueView,
  coverageLine,
  latestCheckpoint,
  queuedView,
} from "@/lib/batch2-view";

// Minimal per-test sessionStorage for the node environment.
beforeEach(() => {
  const m = new Map<string, string>();
  (globalThis as { sessionStorage?: Storage }).sessionStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
});

const pdf = (extra = "body") =>
  new TextEncoder().encode(`%PDF-1.4\n${extra}\n%%EOF\né`);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function capture(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: { url: string; init: RequestInit; body: unknown }[] = [];
  setFetch((async (url: string, init: RequestInit) => {
    calls.push({
      url,
      init,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    return respond(url, init);
  }) as unknown as typeof fetch);
  return calls;
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("exact message payloads", () => {
  it("omits document_refs when empty (legacy bytes) and keeps exact refs otherwise", () => {
    const plain = postMessageBody({
      command_id: "c1",
      expected_work_version: 4,
      text: "Hi",
    });
    expect(plain).not.toHaveProperty("document_refs");
    expect(plain).not.toHaveProperty("attachments");
    const withDocs = postMessageBody({
      command_id: "c2",
      expected_work_version: 4,
      text: "See file",
      attachments: [],
      target: null,
      document_refs: [
        { document_id: "d1", sha256: "a".repeat(64), status: "x" } as never,
      ],
    });
    expect(withDocs.document_refs).toEqual([
      { document_id: "d1", sha256: "a".repeat(64) },
    ]); // only the two ref fields travel
    expect(withDocs).toMatchObject({
      schema_version: "workagent/v1",
      command_id: "c2",
      expected_work_version: 4,
      attachments: [],
      target: null,
    });
  });

  it("Queue later posts the exact PostMessage to queued-messages, not /messages", async () => {
    const calls = capture(() => json(202, { id: "q1" }));
    const body = postMessageBody({
      command_id: "c3",
      expected_work_version: 2,
      text: "Later please",
    });
    await queueApi.queue("ws 1", "cv1", body);
    expect(calls[0]!.url).toBe(
      "/api/domain/v1/workspaces/ws%201/conversations/cv1/queued-messages",
    );
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.body).toEqual(body);
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h["X-Workagent-Client"]).toBe("local-ui");
    expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain(
      "authorization",
    );
  });

  it("cancel / stop / continue carry exact ids and versions", async () => {
    const calls = capture(() => json(200, { id: "x", state: "cancelled" }));
    await queueApi.cancel(
      "ws",
      "cv",
      "q9",
      commandBody("k1", { expected_queue_version: 3 }),
    );
    await runApi.stop(
      "ws",
      "cv",
      commandBody("k2", { expected_work_version: 7, run_id: "run-7" }),
    );
    await runApi.continue(
      "ws",
      "cv",
      commandBody("k3", {
        expected_work_version: 7,
        checkpoint_id: "cp-1",
        checkpoint_hash: "f".repeat(64),
      }),
    );
    expect(
      calls.map((c) =>
        c.url.replace("/api/domain/v1/workspaces/ws/conversations/cv", ""),
      ),
    ).toEqual(["/queued-messages/q9/cancel", "/stop", "/continue"]);
    expect(calls[0]!.body).toMatchObject({
      command_id: "k1",
      expected_queue_version: 3,
    });
    expect(calls[1]!.body).toMatchObject({
      command_id: "k2",
      expected_work_version: 7,
      run_id: "run-7",
    });
    expect(calls[2]!.body).toMatchObject({
      checkpoint_id: "cp-1",
      checkpoint_hash: "f".repeat(64),
      expected_work_version: 7,
    });
    // Stop never targets the conversation-wide cancel route.
    expect(
      calls.some((c) => c.url.endsWith("/cancel") && !c.url.includes("queued")),
    ).toBe(false);
  });

  it("5xx and network failures are unknown outcomes; 409 is definite", async () => {
    capture(() => json(502, { code: "action_unresolved" }));
    const unknown = await runApi
      .stop(
        "ws",
        "cv",
        commandBody("k", { expected_work_version: 1, run_id: "r" }),
      )
      .catch((e) => e);
    expect(unknown).toBeInstanceOf(ApiError);
    expect((unknown as ApiError).isAmbiguousWrite).toBe(true);
    capture(() => json(409, { code: "version_conflict", message: "changed" }));
    const definite = await runApi
      .stop(
        "ws",
        "cv",
        commandBody("k", { expected_work_version: 1, run_id: "r" }),
      )
      .catch((e) => e);
    expect((definite as ApiError).isVersionConflict).toBe(true);
    expect((definite as ApiError).isAmbiguousWrite).toBe(false);
  });
});

describe("document staging", () => {
  it("keeps the exact original: canonical base64 decodes to the same bytes and hash", async () => {
    const bytes = pdf();
    const d = await stageBytes("Report_Q3.pdf", "application/pdf", bytes);
    expect(d.sha256).toBe(sha(bytes));
    expect(d.byte_length).toBe(bytes.length);
    expect(
      Buffer.from(d.content_base64, "base64").equals(Buffer.from(bytes)),
    ).toBe(true);
    expect(d.content_base64).toBe(Buffer.from(bytes).toString("base64"));
    expect(d.mime_type).toBe("application/pdf");
    expect(Object.isFrozen(d)).toBe(true);
  });

  it("refuses names, types, magic and sizes the server would refuse (negative controls)", async () => {
    await expect(stageBytes("Q3 report.pdf", "", pdf())).rejects.toThrow(
      /Rename/,
    );
    await expect(stageBytes("a.txt", "", pdf())).rejects.toThrow(
      /PDF, DOCX and XLSX/,
    );
    await expect(stageBytes("a.docx", "", pdf())).rejects.toThrow(
      /doesn’t look like/,
    );
    await expect(stageBytes("a.pdf", "text/plain", pdf())).rejects.toThrow(
      /doesn’t look like/,
    );
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(pdf().subarray(0, 5));
    await expect(stageBytes("a.pdf", "", big)).rejects.toThrow(/5 MB/);
    // A blank browser MIME for a DOCX with ZIP magic is accepted.
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    await expect(stageBytes("notes.docx", "", zip)).resolves.toMatchObject({
      mime_type:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  });
});

const detailFor = (b: UploadBody): DocumentDetail =>
  ({
    document_id: `doc-${b.sha256.slice(0, 6)}`,
    sha256: b.sha256,
    filename: b.filename,
    mime_type: b.mime_type,
    status: "extracted",
  }) as DocumentDetail;

const dest = { workspace_id: "ws", conversation_id: "cv" };

describe("document upload commands", () => {
  it("an unknown upload replays the identical body; nothing is re-sent as new", async () => {
    const d = await stageBytes("a.pdf", "", pdf());
    let entries: StagedEntry[] = [newEntry(d)];
    const persist = async (n: StagedEntry[]) => void (entries = n);
    const bodies: UploadBody[] = [];
    let fail = true;
    const upload = async (_ws: string, _cid: string, b: UploadBody) => {
      bodies.push(b);
      if (fail)
        throw new ApiError({ code: "transport", status: 0, message: "lost" });
      return detailFor(b);
    };
    await expect(uploadAll(dest, entries, persist, upload)).rejects.toThrow(
      "lost",
    );
    expect(entries[0]!.state).toBe("unknown");
    expect(entries[0]!.upload).not.toBeNull();
    fail = false;
    await uploadAll(dest, entries, persist, upload);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]); // same command_id, request_id, bytes
    expect(entries[0]!.state).toBe("uploaded");
  });

  it("a definite refusal clears the identity so a new attempt is a new command", async () => {
    const d = await stageBytes("a.pdf", "", pdf());
    let entries: StagedEntry[] = [newEntry(d)];
    const persist = async (n: StagedEntry[]) => void (entries = n);
    const ids: string[] = [];
    const refuse = async (_w: string, _c: string, b: UploadBody) => {
      ids.push(b.command_id);
      throw new ApiError({
        code: "validation_error",
        status: 422,
        message: "no",
      });
    };
    await expect(uploadAll(dest, entries, persist, refuse)).rejects.toThrow();
    await expect(uploadAll(dest, entries, persist, refuse)).rejects.toThrow();
    expect(ids[0]).not.toBe(ids[1]);
    expect(entries[0]!.upload).toBeNull();
    expect(entries[0]!.state).toBe("local");
  });

  it("a receipt for different bytes is not accepted as an upload", async () => {
    const d = await stageBytes("a.pdf", "", pdf());
    const wrong = async (_w: string, _c: string, b: UploadBody) =>
      ({ ...detailFor(b), sha256: "0".repeat(64) }) as DocumentDetail;
    const ids = {
      command_id: "c",
      request_id: "r",
      ...dest,
    };
    await expect(uploadStaged(d, ids, wrong)).rejects.toThrow(/didn’t match/);
  });

  it("uploads each original once; a later failure keeps earlier confirmed refs", async () => {
    const a = await stageBytes("a.pdf", "", pdf("one"));
    const b = await stageBytes("b.pdf", "", pdf("two"));
    let entries: StagedEntry[] = [newEntry(a), newEntry(b)];
    const persist = async (n: StagedEntry[]) => void (entries = n);
    const seen: string[] = [];
    let failB = true;
    const upload = async (_w: string, _c: string, body: UploadBody) => {
      seen.push(body.filename);
      if (body.filename === "b.pdf" && failB)
        throw new ApiError({ code: "transport", status: 0, message: "lost" });
      return detailFor(body);
    };
    await expect(uploadAll(dest, entries, persist, upload)).rejects.toThrow();
    expect(entries.map((e) => e.state)).toEqual(["uploaded", "unknown"]);
    failB = false;
    const refs = await uploadAll(dest, entries, persist, upload);
    expect(seen).toEqual(["a.pdf", "b.pdf", "b.pdf"]); // a.pdf never re-uploaded
    expect(refs).toEqual([
      { document_id: `doc-${a.sha256.slice(0, 6)}`, sha256: a.sha256 },
      { document_id: `doc-${b.sha256.slice(0, 6)}`, sha256: b.sha256 },
    ]);
  });

  it("downloads the exact original and refuses bytes that don't match its sha256", async () => {
    const bytes = pdf();
    const meta = {
      document_id: "d1",
      sha256: sha(bytes),
      mime_type: "application/pdf",
    } as never;
    const calls = capture(() => new Response(bytes, { status: 200 }));
    const blob = await documentApi.original("ws", "cv", meta);
    expect(
      Buffer.from(await blob.arrayBuffer()).equals(Buffer.from(bytes)),
    ).toBe(true);
    expect(calls[0]!.url).toBe(
      "/api/domain/v1/workspaces/ws/conversations/cv/documents/d1/download",
    );
    capture(() => new Response(pdf("tampered"), { status: 200 }));
    await expect(documentApi.original("ws", "cv", meta)).rejects.toThrow(
      /digest/,
    );
  });
});

describe("views", () => {
  const q = (over: Partial<QueuedMessage>): QueuedMessage =>
    ({
      id: "q",
      state: "pending",
      reason: null,
      run_id: null,
      ...over,
    }) as QueuedMessage;
  it("held queue entries say why and never claim they will rebase", () => {
    const v = queuedView(q({ state: "held", reason: "work_changed" }));
    expect(v.label).toBe("Held");
    expect(v.note).toMatch(/won’t run against the newer state/);
    expect(v.cancellable).toBe(true);
    expect(queuedView(q({ state: "admitted", run_id: "r" })).cancellable).toBe(
      false,
    );
  });

  const cp = (
    over: Partial<RunCheckpoint["data"]>,
    created = "2026-10-26T10:00:00Z",
    id = "cp",
  ): RunCheckpoint =>
    ({
      checkpoint_id: id,
      created_at: created,
      checkpoint_hash: "h",
      continuation_supported: true,
      data: { waiting: "none", next_safe_action: "continue_slice", ...over },
    }) as RunCheckpoint;
  it("continue only when the server says it is safe; otherwise the reason, no retry", () => {
    expect(continueView(cp({}))).toEqual({ kind: "continue" });
    const unknown = continueView(
      cp({ waiting: "unknown", next_safe_action: "reconcile" }),
    );
    expect(unknown).toMatchObject({ kind: "blocked" });
    expect((unknown as { text: string }).text).toMatch(/nothing is retried/);
    expect(continueView(cp({ next_safe_action: "settled" }))).toBeNull();
    expect(
      continueView(cp({ waiting: "person", next_safe_action: "await_person" })),
    ).toMatchObject({ kind: "blocked" });
  });
  it("continue requires the server's continuation_supported === true; false or missing fails closed", () => {
    for (const next of ["continue_slice", "resume_phase"] as const)
      expect(
        continueView({
          ...cp({ next_safe_action: next }),
          continuation_supported: true,
        }),
      ).toEqual({ kind: "continue" });
    const unsupported = continueView({
      ...cp({}),
      continuation_supported: false,
    });
    expect(unsupported).toMatchObject({ kind: "blocked" });
    expect((unsupported as { text: string }).text).toMatch(
      /Send a new message/,
    );
    const legacy = cp({});
    delete legacy.continuation_supported;
    expect(continueView(legacy)).toMatchObject({
      kind: "blocked",
    });
    // A non-boolean truthy value is not support either.
    expect(
      continueView({
        ...cp({}),
        continuation_supported: "true" as unknown as boolean,
      }),
    ).toMatchObject({ kind: "blocked" });
    // The flag is read-projection only: checkpoint data and hash are untouched.
    const c = cp({});
    expect("continuation_supported" in c.data).toBe(false);
    expect(c.checkpoint_hash).toBe("h");
  });
  it("a step-limited slice with no new progress says it is parked, not that it waits for a reply", () => {
    const parked = (over: Partial<RunCheckpoint> = {}) =>
      ({
        ...cp({ waiting: "blocked", next_safe_action: "await_person" }),
        checkpoint_kind: "settlement",
        assignment_id: null,
        ...over,
      }) as RunCheckpoint;
    const v = continueView(parked(), "step_limit");
    expect(v).toMatchObject({ kind: "blocked", parked: true });
    const text = (v as { text: string }).text;
    expect(text).toMatch(/no new progress/i);
    expect(text).toMatch(/won’t continue on its own/);
    expect(text).not.toMatch(/Reply to give it what it needs/);
    // Same checkpoint shape for other stops keeps its existing wording.
    for (const reason of ["blocked", "budget_limit", null] as const)
      expect(continueView(parked(), reason)).not.toMatchObject({
        parked: true,
      });
    // A responsibility's own hold, or a non-settlement checkpoint, is not this gate.
    expect(
      continueView(parked({ assignment_id: "as1" }), "step_limit"),
    ).not.toMatchObject({ parked: true });
    expect(
      continueView(parked({ checkpoint_kind: "stage" }), "step_limit"),
    ).not.toMatchObject({ parked: true });
    // A genuine wait for the person is unchanged.
    expect(
      continueView(
        cp({ waiting: "person", next_safe_action: "await_person" }),
        "step_limit",
      ),
    ).toEqual({
      kind: "blocked",
      text: "Waiting for you. Reply to give it what it needs.",
    });
  });
  it("latest checkpoint is chosen by recorded time, not id order", () => {
    const l = latestCheckpoint([
      cp({}, "2026-10-26T10:00:05Z", "a"),
      cp({}, "2026-10-26T10:00:09Z", "Z-older-id-sorts-first"),
    ]);
    expect(l!.checkpoint_id).toBe("Z-older-id-sorts-first");
  });
  it("coverage lines are counts the server sent, not estimates", () => {
    expect(
      coverageLine({
        omissions: [],
        total_pages: 60,
        covered_pages: 50,
        omitted_pages: 10,
        empty_pages_needing_ocr: [2],
        partial_last_page: false,
      }),
    ).toBe("Pages 50 of 60; 1 page had no text.");
    expect(coverageLine({ omissions: [] })).toBeNull();
  });
});
