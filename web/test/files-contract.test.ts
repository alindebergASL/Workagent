import { describe, expect, it } from "vitest";
import {
  contentProblem,
  encodeForSave,
  readComplete,
  sha256HexOfBytes,
  toDisplayText,
  READ_CHUNK_LIMIT,
  filenameProblem,
  mimeForFilename,
  sha256HexOfText,
  verifyDownloadedBytes,
  MAX_FILE_BYTES,
} from "@/lib/files-contract";

describe("filename bounds (mirror of the backend pattern)", () => {
  it("accepts the four working text formats with bounded names", () => {
    expect(filenameProblem("notes.txt")).toBeNull();
    expect(filenameProblem("plan-v2.md")).toBeNull();
    expect(filenameProblem("rows.csv")).toBeNull();
    expect(filenameProblem("state_1.json")).toBeNull();
    expect(filenameProblem(`${"a".repeat(81)}.txt`)).toBeNull();
  });
  it("rejects paths, hidden names, overlong names and other suffixes", () => {
    for (const bad of [
      "",
      "../etc.txt",
      "a/b.txt",
      ".hidden.txt",
      "-lead.txt",
      "run.sh",
      "doc.html",
      "doc.pdf",
      `${"a".repeat(82)}.txt`,
      "noext",
    ])
      expect(filenameProblem(bad), bad).not.toBeNull();
  });
  it("derives the exact backend MIME for each suffix", () => {
    expect(mimeForFilename("a.txt")).toBe("text/plain");
    expect(mimeForFilename("a.md")).toBe("text/markdown");
    expect(mimeForFilename("a.markdown")).toBe("text/markdown");
    expect(mimeForFilename("a.csv")).toBe("text/csv");
    expect(mimeForFilename("a.json")).toBe("application/json");
    expect(mimeForFilename("a.exe")).toBeNull();
  });
});

describe("content bounds", () => {
  it("accepts ordinary multi-line text with tabs", () => {
    expect(contentProblem("line one\n\tline two\r\n")).toBeNull();
  });
  it("rejects empty, oversized and control-byte text", () => {
    expect(contentProblem("")).not.toBeNull();
    expect(contentProblem("\u0000")).not.toBeNull();
    expect(contentProblem("\u001b[31mred")).not.toBeNull();
    expect(contentProblem("a".repeat(MAX_FILE_BYTES + 1))).not.toBeNull();
  });
  it("measures the byte limit in UTF-8 bytes, not characters", () => {
    // 3 bytes per char: 66_667 chars exceed 200_000 bytes.
    expect(contentProblem("€".repeat(66667))).not.toBeNull();
    expect(contentProblem("€".repeat(66666))).toBeNull();
  });
});

describe("exact hashing and download verification", () => {
  it("computes the UTF-8 SHA-256 the backend validates against", async () => {
    expect(await sha256HexOfText("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
  it("only accepts a download whose bytes match length and hash exactly", async () => {
    const bytes = new TextEncoder().encode("exact body");
    const buf = bytes.buffer.slice(0) as ArrayBuffer;
    const blob = {
      kind: "generated_blob" as const,
      blob_id: "b1",
      sha256: await sha256HexOfText("exact body"),
      byte_length: bytes.byteLength,
      mime_type: "text/plain",
    };
    expect(await verifyDownloadedBytes(buf, blob)).toBeNull();
    expect(
      await verifyDownloadedBytes(buf, { ...blob, byte_length: 3 }),
    ).toMatch(/manifest records 3/);
    expect(
      await verifyDownloadedBytes(buf, { ...blob, sha256: "0".repeat(64) }),
    ).toMatch(/do not match/);
  });
});

describe("complete verified chunked read", () => {
  async function makeVersion(raw: string) {
    const bytes = new TextEncoder().encode(raw);
    const ref = {
      workspace_file_id: "f1",
      version_id: "v1",
      sha256: await sha256HexOfBytes(bytes),
    };
    const fetchRange = async (offset: number) => {
      const end = Math.min(offset + READ_CHUNK_LIMIT, bytes.byteLength);
      const chunk = bytes.slice(offset, end);
      return {
        ref,
        text: new TextDecoder().decode(chunk),
        offset,
        next_offset: end,
        byte_length: bytes.byteLength,
        chunk_sha256: await sha256HexOfBytes(chunk),
        omitted_ranges: [],
        source_snapshot_id: null,
        has_utf8_bom: raw.startsWith("﻿"),
        newline: "lf" as const,
      };
    };
    return { ref, fetchRange };
  }

  it("assembles multi-chunk content and verifies chunk and full hashes", async () => {
    const raw = "x".repeat(READ_CHUNK_LIMIT * 2 + 17);
    const { ref, fetchRange } = await makeVersion(raw);
    const { last, text } = await readComplete(ref, fetchRange);
    expect(text).toBe(raw);
    expect(last.next_offset).toBe(raw.length);
  });

  it("refuses a chunk answered for a different version", async () => {
    const { ref, fetchRange } = await makeVersion("hello");
    await expect(
      readComplete({ ...ref, version_id: "v2" }, fetchRange),
    ).rejects.toThrow(/different version/);
  });

  it("refuses a chunk whose bytes do not match its recorded hash", async () => {
    const { ref, fetchRange } = await makeVersion("hello");
    await expect(
      readComplete(ref, async (o) => ({
        ...(await fetchRange(o)),
        text: "tampered",
      })),
    ).rejects.toThrow(/hash/);
  });

  it("refuses an assembled result that misses the version hash", async () => {
    const { ref, fetchRange } = await makeVersion("hello");
    await expect(
      readComplete({ ...ref, sha256: "0".repeat(64) }, async (o) => ({
        ...(await fetchRange(o)),
        ref: { ...ref, sha256: "0".repeat(64) },
      })),
    ).rejects.toThrow(/SHA-256/);
  });

  it("refuses a read that never advances", async () => {
    const { ref, fetchRange } = await makeVersion("hello");
    await expect(
      readComplete(ref, async (o) => ({
        ...(await fetchRange(o)),
        next_offset: 0,
        byte_length: 10,
      })),
    ).rejects.toThrow(/advance|hash/);
  });
});

describe("newline and BOM presentation", () => {
  it("normalizes CRLF/CR and strips a BOM for display only", () => {
    expect(toDisplayText("﻿a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
  it("round-trips CRLF and BOM exactly on save", () => {
    expect(encodeForSave("a\nb", true, "crlf")).toEqual({
      content: "﻿a\r\nb",
      normalizes: false,
    });
    expect(encodeForSave("a\nb", false, "lf")).toEqual({
      content: "a\nb",
      normalizes: false,
    });
    expect(encodeForSave("a", false, "none").normalizes).toBe(false);
  });
  it("flags cr and mixed endings as normalizing edits needing consent", () => {
    expect(encodeForSave("a\nb", false, "cr")).toEqual({
      content: "a\nb",
      normalizes: true,
    });
    expect(encodeForSave("a\nb", false, "mixed").normalizes).toBe(true);
  });
  it("display text of a loaded version round-trips when endings are uniform", async () => {
    const exact = "﻿one\r\ntwo\r\n";
    const display = toDisplayText(exact);
    const enc = encodeForSave(display, true, "crlf");
    expect(enc.content).toBe(exact);
    expect(await sha256HexOfText(enc.content)).toBe(
      await sha256HexOfText(exact),
    );
  });
});
