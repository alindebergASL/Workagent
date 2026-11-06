/**
 * Bounded incremental text/event-stream parser for fetch() bodies.
 *
 * Bytes arrive in arbitrary chunks: a UTF-8 character or a CRLF may be split
 * across reads, and one read may carry several frames. Comments (heartbeats)
 * are dropped. A frame larger than the cap throws SseOverflow so the caller
 * can drop the connection and reconnect from its last applied cursor.
 */

export interface SseFrame {
  /** "message" when the frame names no event. */
  readonly event: string;
  readonly data: string;
  /** The id this frame carried, or null. Never inherited from earlier frames. */
  readonly id: string | null;
}

export class SseOverflow extends Error {
  constructor() {
    super("Event frame exceeded the size limit.");
    this.name = "SseOverflow";
  }
}

export const DEFAULT_MAX_FRAME = 64 * 1024;

export class SseParser {
  private readonly decoder = new TextDecoder("utf-8");
  private buf = "";
  private event = "";
  private data: string[] = [];
  private id: string | null = null;
  private hasField = false;
  /** UTF-16 units held for the frame in progress (an upper bound on memory). */
  private frameSize = 0;

  constructor(private readonly maxFrame = DEFAULT_MAX_FRAME) {}

  push(chunk: Uint8Array): SseFrame[] {
    return this.feed(this.decoder.decode(chunk, { stream: true }));
  }

  /** Flushes the decoder. An unterminated final frame is discarded (per spec). */
  end(): SseFrame[] {
    const out = this.feed(this.decoder.decode());
    this.reset();
    this.buf = "";
    return out;
  }

  private feed(text: string): SseFrame[] {
    this.buf += text;
    const out: SseFrame[] = [];
    let start = 0;
    for (;;) {
      let i = start;
      while (
        i < this.buf.length &&
        this.buf[i] !== "\n" &&
        this.buf[i] !== "\r"
      )
        i++;
      if (i >= this.buf.length) break;
      // A trailing CR may be the first half of a CRLF still in flight.
      if (this.buf[i] === "\r" && i + 1 >= this.buf.length) break;
      const line = this.buf.slice(start, i);
      start = i + (this.buf[i] === "\r" && this.buf[i + 1] === "\n" ? 2 : 1);
      const frame = this.line(line);
      if (frame) out.push(frame);
    }
    this.buf = this.buf.slice(start);
    if (this.frameSize + this.buf.length > this.maxFrame) {
      this.reset();
      this.buf = "";
      throw new SseOverflow();
    }
    return out;
  }

  private line(line: string): SseFrame | null {
    if (line === "") {
      const frame = this.hasField
        ? {
            event: this.event || "message",
            data: this.data.join("\n"),
            id: this.id,
          }
        : null;
      this.reset();
      return frame && (frame.data !== "" || frame.id !== null) ? frame : null;
    }
    this.frameSize += line.length + 1;
    if (this.frameSize > this.maxFrame) {
      this.reset();
      this.buf = "";
      throw new SseOverflow();
    }
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") {
      this.event = value;
      this.hasField = true;
    } else if (field === "data") {
      this.data.push(value);
      this.hasField = true;
    } else if (field === "id") {
      if (!value.includes("\0")) this.id = value === "" ? null : value;
      this.hasField = true;
    }
    return null;
  }

  private reset() {
    this.event = "";
    this.data = [];
    this.id = null;
    this.hasField = false;
    this.frameSize = 0;
  }
}
