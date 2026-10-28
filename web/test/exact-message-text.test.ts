import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { postMessageBody, queueApi, setFetch } from "@/lib/client/batch2-api";

// What a person typed is sent exactly: leading spaces, inner and trailing
// newlines and non-ASCII survive. Trim only decides whether there is content.
const EXACT = "  Queue from browser 雪\nPreserve this exact later intent.\n";

const read = (p: string) =>
  readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("exact human text in new Send and Queue commands", () => {
  it("Queue later puts the exact text on the wire", async () => {
    const sent: unknown[] = [];
    setFetch((async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ id: "q1" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch);
    const body = postMessageBody({
      command_id: "c1",
      expected_work_version: 1,
      text: EXACT,
    });
    await queueApi.queue("ws", "cv", body);
    expect((sent[0] as { text: string }).text).toBe(EXACT);
  });

  // No hook harness runs in this node environment, so the hook seam is
  // checked at its source: new attempts carry `text` itself, never a trim.
  it("the conversation reply hook builds new Send and Queue payloads from exact text", () => {
    const src = read("../src/lib/client/conversation-reply.ts");
    expect(src).not.toMatch(/text:\s*text\.trim\(\)/);
    const builders = src.match(/expected_work_version: version,\s*\n\s*text,/g);
    expect(builders).toHaveLength(2);
    // Trim still guards emptiness.
    expect(src).toMatch(/Boolean\(text\.trim\(\)\)/);
  });

  it("Home sends the exact request text and trims only the title", () => {
    const src = read("../src/components/Composer.tsx");
    expect(src).not.toMatch(/const text = request\.trim\(\)/);
    expect(src).not.toMatch(/c\.text = request\.trim\(\) \|\|/);
    expect(src).toMatch(/text: request,/);
    expect(src).toMatch(/c\.text = request\.trim\(\) \? request : c\.text;/);
    expect(src).toMatch(/title: shortTitle\(request\.trim\(\), 120\)/);
  });
});
