/**
 * Staging PDF/DOCX/XLSX originals and uploading them exactly once.
 *
 * A staged document is a frozen local snapshot: the exact bytes (canonical
 * base64), their sha256, the original filename and the MIME type for its
 * extension. Uploading is a normal command: its command_id, request_id and
 * destination conversation are written durably with the staged generation
 * (on this device) before the first attempt, and kept with its receipt. An
 * unknown outcome can only be replayed with the identical body into the same
 * conversation, never re-sent as a new upload; when that identity can't be
 * kept, nothing is sent. A definite refusal clears it.
 */
import { ApiError } from "@/lib/contract/errors";
import {
  DOCUMENT_FILENAME,
  DOCUMENT_MIMES,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_REFS,
  type DocumentDetail,
  type DocumentRef,
  type ExtractionStatus,
} from "@/lib/contract/batch2";
import { documentApi, sha256Hex, type UploadBody } from "./batch2-api";
import { ScopeRefused } from "./session-scope";

export interface StagedDocument {
  readonly filename: string;
  readonly mime_type: string;
  readonly byte_length: number;
  readonly sha256: string;
  readonly content_base64: string;
}

export type UploadState = "local" | "uploading" | "uploaded" | "unknown";

/** One upload command's exact identity and its immutable destination. */
export interface UploadIdentity {
  command_id: string;
  request_id: string;
  workspace_id: string;
  conversation_id: string;
}
export type UploadDestination = Pick<
  UploadIdentity,
  "workspace_id" | "conversation_id"
>;

export interface StagedEntry {
  doc: StagedDocument;
  /** This staging's own id: only this exact generation is ever deleted. */
  generation: string;
  staged_at: number;
  /** False when the device copy could not be written (shown, not hidden). */
  durable: boolean;
  state: UploadState;
  /** Set once the server confirmed the upload. */
  ref: (DocumentRef & { status: ExtractionStatus }) | null;
  /**
   * The upload command, kept durably before it is first sent and kept with
   * its receipt. Null only while nothing has been sent.
   */
  upload: UploadIdentity | null;
}

export const DOCUMENT_ACCEPT = ".pdf,.docx,.xlsx";

export const isDocumentFile = (name: string) =>
  /\.(pdf|docx|xlsx)$/i.test(name);

/** Canonical (padded, no line breaks) base64 of exact bytes. */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function stageBytes(
  filename: string,
  type: string,
  bytes: Uint8Array,
): Promise<StagedDocument> {
  const ext = filename.slice(filename.lastIndexOf(".") + 1);
  if (!(ext in DOCUMENT_MIMES))
    throw new Error("Only PDF, DOCX and XLSX documents can be attached.");
  if (filename.length > 85 || !DOCUMENT_FILENAME.test(filename))
    throw new Error(
      `“${filename}” can’t be attached under that name. Rename it using letters, numbers, “-” or “_” (no spaces), then attach it again.`,
    );
  const mime = DOCUMENT_MIMES[ext as keyof typeof DOCUMENT_MIMES];
  // Browsers often leave the type blank; a conflicting type is refused.
  if (type && type !== mime)
    throw new Error(`“${filename}” doesn’t look like a ${ext.toUpperCase()}.`);
  if (bytes.length === 0) throw new Error(`“${filename}” is empty.`);
  if (bytes.length > MAX_DOCUMENT_BYTES)
    throw new Error(`“${filename}” is larger than 5 MB.`);
  const magic =
    ext === "pdf" ? [0x25, 0x50, 0x44, 0x46, 0x2d] : [0x50, 0x4b, 0x03, 0x04];
  if (!magic.every((b, i) => bytes[i] === b))
    throw new Error(`“${filename}” doesn’t look like a ${ext.toUpperCase()}.`);
  return Object.freeze({
    filename,
    mime_type: mime,
    byte_length: bytes.length,
    sha256: await sha256Hex(bytes),
    content_base64: toBase64(bytes),
  });
}

export async function stageFile(file: File): Promise<StagedDocument> {
  if (file.size > MAX_DOCUMENT_BYTES)
    throw new Error(`“${file.name}” is larger than 5 MB.`);
  return stageBytes(
    file.name,
    file.type,
    new Uint8Array(await file.arrayBuffer()),
  );
}

export const newEntry = (doc: StagedDocument): StagedEntry => ({
  doc,
  generation: crypto.randomUUID(),
  staged_at: Date.now(),
  durable: false,
  state: "local",
  ref: null,
  upload: null,
});

/** Exact bytes back from canonical base64. */
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** The staged generations whose confirmed refs a sent command carried. */
export const sentGenerations = (
  entries: StagedEntry[],
  refs: DocumentRef[],
): string[] =>
  entries
    .filter(
      (e) =>
        e.ref &&
        refs.some(
          (r) =>
            r.document_id === e.ref!.document_id && r.sha256 === e.ref!.sha256,
        ),
    )
    .map((e) => e.generation);

/** True when the staged documents aren't exactly the ones a start expects. */
export function expectedDocumentsMissing(
  expected: { sha256: string }[],
  entries: StagedEntry[],
): boolean {
  const have = entries.map((e) => e.doc.sha256).sort();
  const want = expected.map((e) => e.sha256).sort();
  return have.length !== want.length || want.some((h, i) => h !== have[i]);
}

export function documentsProblem(entries: StagedEntry[]): string | null {
  if (entries.length > MAX_DOCUMENT_REFS)
    return "Attach at most two documents to one message.";
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.doc.sha256)) return "That document is already attached.";
    seen.add(e.doc.sha256);
  }
  return null;
}

// ---- upload commands ----

/** A staged document needs the person to reconcile it before anything sends. */
export class ReconcileRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconcileRequired";
  }
}

const sameDestination = (u: UploadIdentity, d: UploadDestination) =>
  u.workspace_id === d.workspace_id && u.conversation_id === d.conversation_id;

/**
 * Why this entry can't be uploaded/sent to `dest` as it stands (null: it
 * can). A ref or upload identity belongs to exactly one conversation; an
 * upload that may have happened but whose identity this device no longer has
 * is never re-sent as a new command. `dest` null: no conversation yet.
 */
export function entryProblem(
  e: StagedEntry,
  dest: UploadDestination | null,
): string | null {
  const name = `“${e.doc.filename}”`;
  if (e.upload ? !dest || !sameDestination(e.upload, dest) : Boolean(e.ref))
    return `${name} was uploaded for a different conversation start. Use the kept copy as a new upload, or remove it.`;
  if (!e.upload && (e.state === "unknown" || e.state === "uploading"))
    return `An earlier upload of ${name} may have reached Workagent, but this device no longer has its exact command. Use the kept copy as a new upload, or remove it.`;
  return null;
}

export function uploadBody(d: StagedDocument, ids: UploadIdentity): UploadBody {
  return {
    schema_version: "workagent/v1",
    request_id: ids.request_id,
    command_id: ids.command_id,
    filename: d.filename,
    mime_type: d.mime_type,
    content_base64: d.content_base64,
    sha256: d.sha256,
  };
}

/** Sends one upload command with its kept identity; checks the receipt. */
export async function uploadStaged(
  d: StagedDocument,
  ids: UploadIdentity,
  upload = documentApi.upload,
): Promise<DocumentDetail> {
  const detail = await upload(
    ids.workspace_id,
    ids.conversation_id,
    uploadBody(d, ids),
  );
  if (detail.sha256 !== d.sha256 || detail.filename !== d.filename)
    throw new ApiError({
      code: "transport",
      status: 0,
      message: "The upload receipt didn’t match the file. Nothing was sent.",
    });
  return detail;
}

/**
 * Uploads every staged document that has no confirmed ref, in order, into
 * `dest`. Refuses first if any entry needs reconciling. A new command's
 * identity must be durably kept (`persist` resolves) before it is sent; if
 * that fails nothing is sent. Stops at the first failure; confirmed entries
 * keep their ref, so the next attempt never uploads them again.
 */
export async function uploadAll(
  dest: UploadDestination,
  entries: StagedEntry[],
  persist: (next: StagedEntry[]) => Promise<void>,
  upload = documentApi.upload,
): Promise<DocumentRef[]> {
  for (const e of entries) {
    const problem = entryProblem(e, dest);
    if (problem) throw new ReconcileRequired(problem);
  }
  const quietly = (next: StagedEntry[]) => persist(next).catch(() => {});
  let list = entries;
  const put = (i: number, patch: Partial<StagedEntry>) =>
    (list = list.map((e, n) => (n === i ? { ...e, ...patch } : e)));
  for (let i = 0; i < list.length; i++) {
    const entry = list[i]!;
    if (entry.ref) continue;
    let ids = entry.upload;
    if (!ids) {
      ids = {
        command_id: crypto.randomUUID(),
        request_id: crypto.randomUUID(),
        ...dest,
      };
      try {
        await persist(put(i, { state: "uploading", upload: ids }));
      } catch (e) {
        // Not kept: never sent, so it is still only local.
        await quietly(put(i, { state: "local", upload: null }));
        throw e;
      }
    } else void quietly(put(i, { state: "uploading" }));
    try {
      const detail = await uploadStaged(entry.doc, ids, upload);
      // The identity stays with the receipt: if this write is lost, the kept
      // record still replays the same command.
      await quietly(
        put(i, {
          state: "uploaded",
          ref: {
            document_id: detail.document_id,
            sha256: detail.sha256,
            status: detail.status,
          },
        }),
      );
    } catch (e) {
      const unknown = e instanceof ApiError && e.isAmbiguousWrite;
      // Refused by the scope fence before reaching the service: this attempt
      // wasn't sent, but an earlier one may have been, so the exact identity
      // is kept for the same command.
      const fenced = e instanceof ScopeRefused;
      await quietly(
        put(
          i,
          unknown
            ? { state: "unknown" }
            : fenced
              ? { state: entry.upload ? entry.state : "local" }
              : { state: "local", upload: null },
        ),
      );
      throw e;
    }
  }
  return list.map((e) => ({
    document_id: e.ref!.document_id,
    sha256: e.ref!.sha256,
  }));
}
