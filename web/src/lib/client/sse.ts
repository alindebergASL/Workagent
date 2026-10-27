/**
 * A strict, bounded server-sent events parser for streams read with fetch
 * (EventSource can't send the headers the local proxy requires). It follows
 * the HTML event-stream rules: CR, LF or CRLF line ends; `:` comments;
 * `data` lines joined with "\n"; `id` kept until changed; `retry` digits only.
 * A character split across chunks is decoded whole. Malformed UTF-8 or an
 * oversized frame is an error, never a guess: the caller reconnects from the
 * last event it applied.
 */

export type SseFrame = {
  /** The `event` field, "message" when absent. */
  type: string;
  data: string;
  /** The last event ID in effect when this frame was dispatched. */
  id: string;
};

export type SseOutput =
  | { kind: "frame"; frame: SseFrame }
  /** A comment line, e.g. a heartbeat: proof the stream is alive, not data. */
  | { kind: "comment" }
  | { kind: "retry"; ms: number };

export class SseError extends Error {
  constructor(
    readonly code: "frame_too_large" | "malformed_utf8",
    message: string,
  ) {
    super(message);
  }
}

/** Proposed by the Batch 2 plan: one frame (its lines together) up to 16 KiB. */
export const SSE_FRAME_LIMIT = 16 * 1024;

export function sseParser(limit = SSE_FRAME_LIMIT) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let started = false;
  let text = "";
  let pendingCR = false;
  let type = "";
  let data: string[] = [];
  let lastId = "";
  let frameSize = 0;
  const bytes = (s: string) => new TextEncoder().encode(s).length;

  function line(l: string, out: SseOutput[]) {
    if (l === "") {
      if (data.length)
        out.push({
          kind: "frame",
          frame: { type: type || "message", data: data.join("\n"), id: lastId },
        });
      type = "";
      data = [];
      frameSize = 0;
      return;
    }
    frameSize += bytes(l) + 1;
    if (frameSize > limit)
      throw new SseError(
        "frame_too_large",
        `An event was larger than ${limit} bytes.`,
      );
    if (l.startsWith(":")) {
      out.push({ kind: "comment" });
      return;
    }
    const colon = l.indexOf(":");
    const field = colon < 0 ? l : l.slice(0, colon);
    let value = colon < 0 ? "" : l.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") data.push(value);
    else if (field === "event") type = value;
    else if (field === "id") {
      if (!value.includes("\0")) lastId = value;
    } else if (field === "retry" && /^\d+$/.test(value))
      out.push({ kind: "retry", ms: Number(value) });
  }

  function drain(out: SseOutput[]) {
    for (;;) {
      // A CR that ended the last chunk may be the first half of CRLF.
      if (pendingCR && text) {
        pendingCR = false;
        if (text.startsWith("\n")) text = text.slice(1);
      }
      const i = text.search(/[\r\n]/);
      if (i < 0) break;
      let next = i + 1;
      if (text[i] === "\r") {
        if (next === text.length) pendingCR = true;
        else if (text[next] === "\n") next++;
      }
      const l = text.slice(0, i);
      text = text.slice(next);
      line(l, out);
    }
    if (bytes(text) + frameSize > limit)
      throw new SseError(
        "frame_too_large",
        `An event was larger than ${limit} bytes.`,
      );
  }

  return {
    push(chunk: Uint8Array): SseOutput[] {
      let s: string;
      try {
        s = decoder.decode(chunk, { stream: true });
      } catch {
        throw new SseError("malformed_utf8", "The stream was not valid UTF-8.");
      }
      if (!started && s) {
        started = true;
        if (s.startsWith("﻿")) s = s.slice(1);
      }
      text += s;
      const out: SseOutput[] = [];
      drain(out);
      return out;
    },
    /** End of stream: an unterminated frame is discarded, as the rules say. */
    end(): SseOutput[] {
      try {
        decoder.decode();
      } catch {
        throw new SseError("malformed_utf8", "The stream was not valid UTF-8.");
      }
      return [];
    },
  };
}
