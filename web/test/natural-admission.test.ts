import { describe, expect, it, vi } from "vitest";

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
        "http://natural.test/api/domain",
        bearer,
        requestId,
      ),
  };
});

import { conversationApi } from "../src/lib/client/real-api";
import {
  attachmentsProblem,
  readAttachment,
  turnProgress,
  type MessageAttachment,
} from "../src/lib/contract/natural";

const csv: MessageAttachment = {
  filename: "invoices.csv",
  mime_type: "text/csv",
  content: "id,quantity,unit_price,reported_total\nA,1,10,10\n",
};
const target = {
  artifact_id: "a",
  revision_id: "r2",
  body_hash: "a".repeat(64),
};

describe("natural admission payload (contract from PR #9)", () => {
  it("sends attachments and an exact target, never an operation, and replays byte-identically", async () => {
    const requests: string[] = [];
    transport.mockImplementation(async (request: Request) => {
      requests.push(await request.text());
      throw new TypeError("Synthetic acknowledgement lost");
    });
    const payload = {
      command_id: "command-natural-1",
      expected_work_version: 3,
      text: "Recalculate my saved table using round-half-even.",
      attachments: [csv],
      target,
    };
    for (let i = 0; i < 2; i++)
      await expect(
        conversationApi.send("w", "c", structuredClone(payload)),
      ).rejects.toMatchObject({ code: "transport" });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
    const body = JSON.parse(requests[0]!);
    expect(body).toMatchObject({
      schema_version: "workagent/v1",
      command_id: "command-natural-1",
      expected_work_version: 3,
      text: payload.text,
      attachments: [csv],
      target,
    });
    expect(body).not.toHaveProperty("operation");
    expect(body.attachments[0]).not.toHaveProperty("sha256");
  });

  it("leaves the released message shape untouched when not asked for", async () => {
    const requests: string[] = [];
    transport.mockImplementation(async (request: Request) => {
      requests.push(await request.text());
      throw new TypeError("lost");
    });
    await expect(
      conversationApi.send("w", "c", {
        command_id: "command-plain-1",
        expected_work_version: 1,
        text: "Hello",
      }),
    ).rejects.toMatchObject({ code: "transport" });
    const body = JSON.parse(requests[0]!);
    expect(body).not.toHaveProperty("attachments");
    expect(body).not.toHaveProperty("target");
  });

  it("validates files and totals against the stated limits", async () => {
    const file = (name: string, text: string) => new File([text], name);
    await expect(
      readAttachment(file("invoices.csv", "a,b\n")),
    ).resolves.toEqual({
      filename: "invoices.csv",
      mime_type: "text/csv",
      content: "a,b\n",
    });
    await expect(
      readAttachment(file("notes.txt", "hi")),
    ).resolves.toMatchObject({
      mime_type: "text/plain",
    });
    for (const bad of ["../x.csv", "report.xlsx", "_x.csv", "a b.csv"])
      await expect(readAttachment(file(bad, "x"))).rejects.toThrow();
    await expect(readAttachment(file("empty.csv", ""))).rejects.toThrow(
      "empty",
    );
    await expect(readAttachment(file("nul.txt", "a\u0000b"))).rejects.toThrow(
      "NUL",
    );
    await expect(
      readAttachment(new File([new Uint8Array([0xff, 0xfe])], "bin.txt")),
    ).rejects.toThrow("UTF-8");
    expect(attachmentsProblem([csv, csv])).toBeNull();
    expect(attachmentsProblem([csv, csv, csv])).toMatch("two");
    const big = { ...csv, content: "é".repeat(100001) }; // 200002 bytes
    expect(attachmentsProblem([big])).toMatch("200 KB");
  });
});

describe("turn progress on the model path", () => {
  it("keeps only the reported fields and treats a retained result as read-only data", () => {
    expect(turnProgress({ run_id: "r", state: "queued" })).toBeUndefined();
    expect(
      turnProgress({
        run_id: "r",
        state: "unavailable",
        provider_observation: "outcome_unknown",
        evidence_origin: "unverified",
        retained_local_result: {
          status: "observed",
          published: false,
          output: { kind: "run_wasm", value: "9007199254740993" },
        },
      }),
    ).toEqual({
      provider_observation: "outcome_unknown",
      evidence_origin: "unverified",
      retained_local_result: {
        status: "observed",
        published: false,
        output: { kind: "run_wasm", value: "9007199254740993" },
      },
    });
  });
});
