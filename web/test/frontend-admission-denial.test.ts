import { expect, it, vi } from "vitest";
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
        "http://admission.test/api/domain",
        bearer,
        requestId,
      ),
  };
});
import { conversationApi } from "@/lib/client/real-api";

it.each([
  [422, "unsupported_operation"],
  [403, "not_found_or_not_authorized"],
  [409, "budget_exhausted"],
] as const)(
  "real natural message preserves server denial %s/%s without fallback or replay",
  async (status, code) => {
    transport.mockReset();
    const sent: unknown[] = [];
    transport.mockImplementation(async (request: Request) => {
      sent.push(await request.json());
      return new Response(
        JSON.stringify({
          code,
          message: "Synthetic server refusal",
          next_action: "Review the current configuration.",
        }),
        {
          status,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    const body = {
      command_id: `refused-${code}`,
      expected_work_version: 3,
      text: "Use this attachment for my saved table",
      attachments: [
        {
          filename: "input.csv",
          mime_type: "text/csv" as const,
          content: "id,value\na,1\n",
        },
      ],
      target: {
        artifact_id: "saved",
        revision_id: "exact",
        body_hash: "a".repeat(64),
      },
    };
    await expect(conversationApi.send("w", "c", body)).rejects.toMatchObject({
      status,
      code,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(sent[0]).toMatchObject(body);
    expect(body.attachments[0]?.content).toBe("id,value\na,1\n");
  },
);
