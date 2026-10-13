import { describe, expect, it } from "vitest";
import vectors from "./fixtures/attachment-vectors.json";
import { attachmentMime, readAttachment } from "../src/lib/contract/natural";

const bytes = (hex: string) =>
  new Uint8Array((hex.match(/../g) ?? []).map((b) => parseInt(b, 16)));

/**
 * The same vectors run in the browser regressions and against the backend's
 * AttachmentInput (scripts/attachment-parity.py), so all three agree.
 */
describe("attachment admission vectors (published contract)", () => {
  for (const v of vectors.vectors)
    it(`${v.ok ? "admits" : "refuses"} ${JSON.stringify(v.name)}`, async () => {
      const file = new File([bytes(v.hex)], v.name);
      if (!v.ok) {
        await expect(readAttachment(file)).rejects.toThrow();
        return;
      }
      const read = await readAttachment(file);
      expect(read.filename).toBe(v.name);
      expect(read.mime_type).toBe(v.mime);
      expect(attachmentMime(v.name)).toBe(v.mime);
      // Exact bytes: BOM, CRLF and every other byte round-trip unchanged.
      expect(
        Buffer.from(new TextEncoder().encode(read.content)).toString("hex"),
      ).toBe(v.hex);
    });
});
