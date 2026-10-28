/**
 * B3.0b workspace-files view helpers. Every wire shape is an alias of the
 * generated workagent/v1 contract (contracts/src/schema.d.ts); nothing here
 * is a second wire contract. File and version IDs are opaque metadata, not
 * paths. Only client-side helpers (bounds mirrors, hashing, chunk assembly,
 * newline/BOM presentation) live in this module.
 */
import type { components } from "../../../contracts/src/client";
import { ApiError } from "@/lib/contract/errors";

type S = components["schemas"];

export type WorkspaceFile = S["WorkspaceFile"];
export type WorkspaceFilePage = S["WorkspaceFilePage"];
export type FileVersionRef = S["FileVersionRef"];
export type OmittedByteRange = S["OmittedByteRange"];
export type FileRange = S["FileRange"];
export type FileComparison = S["FileComparison"];
export type ExportManifest = S["ExportManifest"];
export type GeneratedBlobRef = S["GeneratedBlobRef"];
export type WorkingText = S["WorkingText"];
export type CreateWorkspaceFile = S["CreateWorkspaceFile"];
export type EditWorkspaceFile = S["EditWorkspaceFile"];
export type ExportFile = S["ExportFile"];
export type SourceSnapshot = S["SourceSnapshot"];
export type TextMime = WorkingText["mime_type"];
export type ExportFormat = ExportFile["format"];
export type NewlineStyle = FileRange["newline"];

export const MAX_FILE_BYTES = 200000;
export const READ_CHUNK_LIMIT = 8192;
export const FILENAME_RE =
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(txt|md|markdown|csv|json)$/;
export const TEXT_MIMES: Record<string, TextMime> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};
export const EXPORT_FORMATS: ExportFormat[] = [
  "txt",
  "markdown",
  "csv",
  "json",
];

export function mimeForFilename(filename: string): TextMime | null {
  const m = FILENAME_RE.exec(filename);
  return m ? TEXT_MIMES[m[1]!]! : null;
}

/** Client-side mirror of the backend bound so problems surface before a send. */
export function filenameProblem(filename: string): string | null {
  if (!filename.trim()) return "Give the file a name.";
  if (!FILENAME_RE.test(filename))
    return "Use letters, digits, - or _ (up to 81 characters) and end with .txt, .md, .markdown, .csv or .json.";
  return null;
}

export function contentProblem(content: string): string | null {
  if (content.length === 0) return "The file needs some text.";
  if (utf8Length(content) > MAX_FILE_BYTES)
    return `Working files are limited to ${MAX_FILE_BYTES.toLocaleString()} bytes of text.`;
  for (const ch of content) {
    const c = ch.codePointAt(0)!;
    if (c < 32 && ch !== "\r" && ch !== "\n" && ch !== "\t")
      return "The text contains control bytes that aren’t working text.";
  }
  return null;
}

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

export async function sha256HexOfText(text: string): Promise<string> {
  return sha256HexOfBytes(new TextEncoder().encode(text));
}

export async function sha256HexOfBytes(
  bytes: Uint8Array | ArrayBuffer,
): Promise<string> {
  const buf = bytes instanceof ArrayBuffer ? bytes : toArrayBuffer(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

// Locally raised integrity refusal (status 0): shown verbatim to the user.
const refusal = (message: string) =>
  new ApiError({ code: "validation_error", status: 0, message });

/**
 * Reads one exact version completely in bounded chunks. Every chunk must
 * come back for the same requested ref, match its own chunk hash, and
 * advance; the assembled text must reproduce the version's exact byte length
 * and SHA-256 before anything is shown as "the file".
 */
export async function readComplete(
  expected: FileVersionRef,
  fetchRange: (offset: number) => Promise<FileRange>,
): Promise<{ last: FileRange; text: string }> {
  let offset = 0;
  let text = "";
  const maxChunks = Math.ceil(MAX_FILE_BYTES / READ_CHUNK_LIMIT) + 2;
  for (let i = 0; i < maxChunks; i++) {
    const r = await fetchRange(offset);
    if (
      r.ref.workspace_file_id !== expected.workspace_file_id ||
      r.ref.version_id !== expected.version_id ||
      r.ref.sha256 !== expected.sha256
    )
      throw refusal(
        "The service answered for a different version than the one requested; nothing was loaded.",
      );
    if (r.offset !== offset)
      throw refusal("The service returned bytes for a different offset.");
    if ((await sha256HexOfText(r.text)) !== r.chunk_sha256)
      throw refusal(
        "A chunk of the file did not match its recorded hash; nothing was loaded.",
      );
    if (r.byte_length > MAX_FILE_BYTES)
      throw refusal(
        `This version is larger than the ${MAX_FILE_BYTES.toLocaleString()}-byte working-file bound and cannot be shown in full here.`,
      );
    text += r.text;
    if (r.next_offset >= r.byte_length) {
      if (
        utf8Length(text) !== r.byte_length ||
        (await sha256HexOfText(text)) !== expected.sha256
      )
        throw refusal(
          "The assembled file does not match the version’s exact SHA-256; nothing was loaded.",
        );
      return { last: r, text };
    }
    if (r.next_offset <= r.offset)
      throw refusal("Reading the file did not advance; nothing was loaded.");
    offset = r.next_offset;
  }
  throw refusal("The file needed more chunks than its size allows.");
}

/**
 * A browser textarea normalizes CR and CRLF to LF, so the editor works on a
 * normalized view and re-encodes on save. The BOM is kept out of the editable
 * text (it is invisible and trivially deleted by accident) and restored on
 * save when the loaded bytes had one.
 */
export function toDisplayText(exact: string): string {
  return exact.replace(/^﻿/, "").replace(/\r\n|\r/g, "\n");
}

/**
 * Re-encodes an edited display text into the exact bytes to save. `crlf`,
 * `lf` and `none` round-trip exactly; `cr` and `mixed` endings cannot be
 * reconstructed from a normalized textarea, so an actual edit normalizes to
 * LF and `normalizes` is true — the UI must get explicit consent first.
 */
export function encodeForSave(
  display: string,
  hasBom: boolean,
  newline: NewlineStyle,
): { content: string; normalizes: boolean } {
  const body = newline === "crlf" ? display.replace(/\n/g, "\r\n") : display;
  return {
    content: hasBom ? `﻿${body}` : body,
    normalizes: newline === "cr" || newline === "mixed",
  };
}

/**
 * A download is only offered after the received bytes match the manifest's
 * exact blob length and SHA-256; a mismatch names what differed instead.
 */
export async function verifyDownloadedBytes(
  bytes: ArrayBuffer,
  blob: GeneratedBlobRef,
): Promise<string | null> {
  if (bytes.byteLength !== blob.byte_length)
    return `Received ${bytes.byteLength} bytes but the export manifest records ${blob.byte_length}.`;
  const got = await sha256HexOfBytes(bytes);
  if (got !== blob.sha256)
    return "The downloaded bytes do not match the export’s recorded SHA-256.";
  return null;
}
