import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  draftScope,
  forgetGenerations,
  memoryDocStore,
  persistEntries,
  restoreEntries,
  toRecord,
} from "@/lib/client/doc-store";
import {
  newEntry,
  sentGenerations,
  stageBytes,
  type StagedEntry,
} from "@/lib/client/documents";
import { continueTarget } from "@/lib/batch2-view";
import { messageDocuments } from "@/lib/client/real-api";
import { MessageDocuments } from "@/components/Batch2Controls";
import type { RunCheckpoint } from "@/lib/contract/batch2";

const pdf = (tag: string) =>
  new TextEncoder().encode(`%PDF-1.7\n${tag}\nÿ\u0000binary`);
const scope = draftScope("local-human", "ws1", "home");

describe("durable staged documents (store adapter boundary)", () => {
  it("restores exact bytes, hash and upload state after a reload", async () => {
    const store = memoryDocStore();
    const doc = await stageBytes("a.pdf", "", pdf("one"));
    const entry: StagedEntry = {
      ...newEntry(doc),
      state: "uploading", // the page went away mid-upload
    };
    const { list, failed } = await persistEntries(store, scope, [entry]);
    expect(failed).toBe(false);
    expect(list[0]!.durable).toBe(true);
    // Stored as binary, not a base64 string.
    const rec = [...store.records.values()][0]!;
    expect(rec.bytes).toBeInstanceOf(ArrayBuffer);
    expect(JSON.stringify(Object.keys(rec))).not.toContain("content_base64");

    const { list: back, corrupt } = await restoreEntries(store, scope);
    expect(corrupt).toEqual([]);
    expect(back[0]!.doc).toEqual(doc); // same base64, sha256, name, MIME
    expect(back[0]!.generation).toBe(entry.generation);
    expect(back[0]!.state).toBe("unknown"); // never "uploaded" by assumption
  });

  it("is scoped: another workspace, principal or draft sees nothing", async () => {
    const store = memoryDocStore();
    await persistEntries(store, scope, [
      newEntry(await stageBytes("a.pdf", "", pdf("x"))),
    ]);
    for (const other of [
      draftScope("local-human", "ws2", "home"),
      draftScope("someone-else", "ws1", "home"),
      draftScope("local-human", "ws1", "conversation:c1"),
    ])
      expect((await restoreEntries(store, other)).list).toEqual([]);
  });

  it("deletes only the exact confirmed generations, keeping later ones", async () => {
    const store = memoryDocStore();
    const a = newEntry(await stageBytes("a.pdf", "", pdf("a")));
    const b = newEntry(await stageBytes("b.pdf", "", pdf("b")));
    await persistEntries(store, scope, [a, b]);
    await forgetGenerations(store, scope, [a.generation]);
    const left = (await restoreEntries(store, scope)).list;
    expect(left.map((e) => e.generation)).toEqual([b.generation]);
  });

  it("a corrupted device copy is reported and kept, not silently dropped", async () => {
    const store = memoryDocStore();
    const e = newEntry(await stageBytes("a.pdf", "", pdf("a")));
    const rec = toRecord(scope, e);
    new Uint8Array(rec.bytes)[0] = 0x00;
    await store.put(rec);
    const { list, corrupt } = await restoreEntries(store, scope);
    expect(list).toEqual([]);
    expect(corrupt.map((c) => c.filename)).toEqual(["a.pdf"]);
    expect(store.records.size).toBe(1);
  });

  it("a storage failure is explicit and the entry stays attached", async () => {
    const store = memoryDocStore(true);
    const e = newEntry(await stageBytes("a.pdf", "", pdf("a")));
    const { list, failed } = await persistEntries(store, scope, [e]);
    expect(failed).toBe(true);
    expect(list).toHaveLength(1);
    expect(list[0]!.durable).toBe(false);
  });

  it("sent generations match exact confirmed refs only", async () => {
    const a = {
      ...newEntry(await stageBytes("a.pdf", "", pdf("a"))),
      ref: { document_id: "d1", sha256: "s1", status: "extracted" as const },
    };
    const b = {
      ...newEntry(await stageBytes("b.pdf", "", pdf("b"))),
      ref: { document_id: "d2", sha256: "s2", status: "extracted" as const },
    };
    const c = newEntry(await stageBytes("c.pdf", "", pdf("c"))); // not uploaded
    expect(
      sentGenerations([a, b, c], [{ document_id: "d1", sha256: "s1" }]),
    ).toEqual([a.generation]);
    // Same id but different hash is not the sent document.
    expect(
      sentGenerations([a], [{ document_id: "d1", sha256: "other" }]),
    ).toEqual([]);
  });
});

describe("Continue applies only to the latest run's newest checkpoint", () => {
  const cp = (id: string, run: string, at: string, safe = true) =>
    ({
      checkpoint_id: id,
      run_id: run,
      created_at: at,
      checkpoint_hash: "h",
      continuation_supported: true,
      data: {
        waiting: safe ? "none" : "blocked",
        next_safe_action: safe ? "continue_slice" : "settled",
      },
    }) as RunCheckpoint;

  it("offers the newest checkpoint when it belongs to the latest run", () => {
    expect(
      continueTarget(
        [
          cp("a", "r1", "2026-10-26T10:00:00Z"),
          cp("b", "r2", "2026-10-26T11:00:00Z"),
        ],
        "r2",
      )!.checkpoint_id,
    ).toBe("b");
  });
  it("never falls back to an older safe checkpoint (negative controls)", () => {
    // Newest is for an older run than the latest one.
    expect(
      continueTarget([cp("a", "r1", "2026-10-26T10:00:00Z")], "r2"),
    ).toBeNull();
    // Newest is the latest run's but unsafe; an older safe one is not used.
    const picked = continueTarget(
      [
        cp("old-safe", "r2", "2026-10-26T10:00:00Z"),
        cp("new-settled", "r2", "2026-10-26T11:00:00Z", false),
      ],
      "r2",
    );
    expect(picked!.checkpoint_id).toBe("new-settled");
    // No latest run known: nothing.
    expect(
      continueTarget([cp("a", "r1", "2026-10-26T10:00:00Z")], null),
    ).toBeNull();
  });
});

describe("message document refs", () => {
  it("maps metadata only and never carries extracted text", () => {
    const docs = messageDocuments({
      document_refs: [
        {
          document_id: "d1",
          sha256: "s",
          filename: "a.pdf",
          byte_length: 10,
          status: "needs_ocr",
          text: "SECRET BODY",
        },
        { document_id: 5 },
      ],
    });
    expect(docs).toEqual([
      {
        document_id: "d1",
        sha256: "s",
        filename: "a.pdf",
        byte_length: 10,
        status: "needs_ocr",
      },
    ]);
    expect(messageDocuments({})).toEqual([]);
  });
  it("renders filename and truthful status per message", () => {
    const html = renderToStaticMarkup(
      createElement(MessageDocuments, {
        docs: [
          {
            document_id: "d1",
            sha256: "s",
            filename: "scan.pdf",
            byte_length: 2048,
            status: "needs_ocr",
          },
        ],
        href: (id: string) => `#document-${id}`,
      }),
    );
    expect(html).toContain("scan.pdf");
    expect(html).toContain("needs OCR");
    expect(html).toContain("#document-d1");
  });
});
