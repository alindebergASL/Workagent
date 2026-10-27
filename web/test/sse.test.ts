import { describe, expect, it } from "vitest";
import { SseError, sseParser, type SseOutput } from "../src/lib/client/sse";

const enc = new TextEncoder();
const frames = (outs: SseOutput[]) =>
  outs.flatMap((o) => (o.kind === "frame" ? [o.frame] : []));

function feed(chunks: (string | Uint8Array)[], limit?: number) {
  const p = sseParser(limit);
  const out: SseOutput[] = [];
  for (const c of chunks)
    out.push(...p.push(typeof c === "string" ? enc.encode(c) : c));
  out.push(...p.end());
  return out;
}

describe("server-sent events parser", () => {
  it("reads several events in one chunk, with id, type and joined data", () => {
    const out = frames(
      feed([
        'id: c1\nevent: work.changed\ndata: {"a":1}\n\nid: c2\ndata: one\ndata: two\n\n',
      ]),
    );
    expect(out).toEqual([
      { type: "work.changed", data: '{"a":1}', id: "c1" },
      { type: "message", data: "one\ntwo", id: "c2" },
    ]);
  });

  it("keeps a character split across chunks whole", () => {
    const bytes = enc.encode("data: Café ✓\n\n");
    // Split inside the two-byte é and inside the three-byte ✓.
    const cuts = [9, 13];
    const parts = [
      bytes.slice(0, cuts[0]),
      bytes.slice(cuts[0], cuts[1]),
      bytes.slice(cuts[1]),
    ];
    expect(frames(feed(parts))).toEqual([
      { type: "message", data: "Café ✓", id: "" },
    ]);
  });

  it("accepts CR, LF and CRLF, including a CRLF split across chunks", () => {
    expect(
      frames(feed(["data: a\r", "\n\r\n", "data: b\r\rdata: c\n\n"])),
    ).toEqual([
      { type: "message", data: "a", id: "" },
      { type: "message", data: "b", id: "" },
      { type: "message", data: "c", id: "" },
    ]);
  });

  it("treats comments as heartbeats, not data, and ignores a leading BOM", () => {
    const out = feed(["﻿: keep-alive\n\n", ": ping\n", "data: x\n\n"]);
    expect(out.filter((o) => o.kind === "comment")).toHaveLength(2);
    expect(frames(out)).toEqual([{ type: "message", data: "x", id: "" }]);
  });

  it("keeps the last id until a new one, and ignores an id with NUL", () => {
    const out = frames(
      feed(["id: c1\ndata: a\n\ndata: b\n\nid: bad\u0000\ndata: c\n\n"]),
    );
    expect(out.map((f) => f.id)).toEqual(["c1", "c1", "c1"]);
  });

  it("dispatches nothing for a frame without data, or one cut off at the end", () => {
    expect(frames(feed(["event: x\n\n", "data: unfinished"]))).toEqual([]);
  });

  it("reads retry only as digits", () => {
    const out = feed(["retry: 3000\nretry: 1s\n\n"]);
    expect(out.filter((o) => o.kind === "retry")).toEqual([
      { kind: "retry", ms: 3000 },
    ]);
  });

  it("refuses an oversized frame, even before its line ends", () => {
    expect(() => feed([`data: ${"x".repeat(200)}\n\n`], 100)).toThrow(SseError);
    expect(() => feed([`data: ${"x".repeat(200)}`], 100)).toThrow(
      /larger than 100 bytes/,
    );
    // Many small lines in one frame count together.
    expect(() =>
      feed(
        [Array.from({ length: 20 }, () => "data: xxxxxxxx\n").join("")],
        100,
      ),
    ).toThrow(SseError);
  });

  it("refuses malformed UTF-8 instead of guessing", () => {
    expect(() => feed([new Uint8Array([0x64, 0x61, 0xff, 0x0a])])).toThrow(
      /not valid UTF-8/,
    );
    // A truncated character at the very end is malformed too.
    expect(() => feed([enc.encode("data: é").slice(0, -1)])).toThrow(SseError);
  });
});
