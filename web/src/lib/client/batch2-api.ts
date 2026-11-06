/**
 * Exact commands and reads for queue / stop / continue / documents.
 *
 * Every command body is built once and kept with its pending command, so a
 * retry after an unknown outcome sends the identical bytes (same command_id,
 * request_id and payload). Nothing here acknowledges anything on its own:
 * only a server response resolves a command.
 */
import { ApiError } from "@/lib/contract/errors";
import type { ErrorCode } from "@/lib/contract/types";
import type {
  DocumentDetail,
  DocumentMetadata,
  DocumentRef,
  PostMessageBody,
  QueuedMessage,
  RunCheckpoint,
} from "@/lib/contract/batch2";
import type { ExactTarget, MessageAttachment } from "@/lib/contract/natural";
import { assertScope, captureScope, scopedFetch } from "./session-scope";

export const BASE = "/api/domain";
const rid = () => crypto.randomUUID();
const conv = (ws: string, cid: string) =>
  `${BASE}/v1/workspaces/${encodeURIComponent(ws)}/conversations/${encodeURIComponent(cid)}`;

type Fetch = typeof fetch;
let rawFetch: Fetch = (...a) => fetch(...a);
/** Every request carries this page's bound scope (see session-scope). */
const doFetch: Fetch = (input, init) => scopedFetch(input, init, rawFetch);
/** Tests only. */
export const setFetch = (f: Fetch) => {
  rawFetch = f;
};

export async function call<T>(
  url: string,
  init: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const scope = captureScope();
  let res: Response;
  try {
    res = await doFetch(url, {
      method: init.method ?? "GET",
      headers: {
        "X-Workagent-Client": "local-ui",
        "X-Schema-Version": "workagent/v1",
        "X-Request-Id": rid(),
        ...(init.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: init.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    if (e instanceof ApiError) throw e; // scope fence: unsent or unknown
    throw new ApiError({
      code: "transport",
      status: 0,
      message: "Could not reach the local service.",
    });
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* a lost or non-JSON body is treated as unconfirmed below */
  }
  // Fenced while the body arrived: sent, so unknown; never returned.
  assertScope(scope);
  if (!res.ok || data === null) {
    const e = (data ?? {}) as {
      code?: ErrorCode;
      message?: string;
      request_id?: string;
      next_action?: string;
      details?: never;
    };
    // 5xx or an unreadable success: the write may have happened.
    throw new ApiError({
      code: res.status >= 500 || res.ok ? "transport" : (e.code ?? "transport"),
      status: res.status,
      message: e.message ?? "Could not confirm the request.",
      requestId: e.request_id,
      nextAction: e.next_action,
      details: e.details,
    });
  }
  return data as T;
}

// ---- exact payload builders (pure; tested) ----

export function postMessageBody(c: {
  command_id: string;
  expected_work_version: number;
  text: string;
  attachments?: MessageAttachment[];
  target?: ExactTarget | null;
  document_refs?: DocumentRef[];
}): PostMessageBody {
  const natural = c.attachments !== undefined || c.target !== undefined;
  return {
    schema_version: "workagent/v1",
    request_id: rid(),
    command_id: c.command_id,
    expected_work_version: c.expected_work_version,
    text: c.text,
    ...(natural
      ? { attachments: c.attachments ?? [], target: c.target ?? null }
      : {}),
    ...(c.document_refs?.length
      ? {
          document_refs: c.document_refs.map((r) => ({
            document_id: r.document_id,
            sha256: r.sha256,
          })),
        }
      : {}),
  };
}

export const commandBody = <T extends object>(
  command_id: string,
  fields: T,
) => ({
  schema_version: "workagent/v1" as const,
  request_id: rid(),
  command_id,
  ...fields,
});

// ---- B2.4 ----

export const queueApi = {
  /** Queue later: stores the exact PostMessage; no run starts now. */
  queue: (ws: string, cid: string, body: PostMessageBody) =>
    call<QueuedMessage>(`${conv(ws, cid)}/queued-messages`, {
      method: "POST",
      body,
    }),
  list: (ws: string, cid: string, signal?: AbortSignal) =>
    call<{ items: QueuedMessage[] }>(`${conv(ws, cid)}/queued-messages`, {
      signal,
    }),
  cancel: (
    ws: string,
    cid: string,
    qid: string,
    body: ReturnType<typeof commandBody<{ expected_queue_version: number }>>,
  ) =>
    call<QueuedMessage>(
      `${conv(ws, cid)}/queued-messages/${encodeURIComponent(qid)}/cancel`,
      { method: "POST", body },
    ),
};

export const runApi = {
  /** Stops exactly this run at this version; never "the latest". */
  stop: (
    ws: string,
    cid: string,
    body: ReturnType<
      typeof commandBody<{ expected_work_version: number; run_id: string }>
    >,
  ) =>
    call<{ id: string; state: string }>(`${conv(ws, cid)}/stop`, {
      method: "POST",
      body,
    }),
  checkpoints: (ws: string, cid: string, signal?: AbortSignal) =>
    call<{ items: RunCheckpoint[] }>(`${conv(ws, cid)}/checkpoints`, {
      signal,
    }),
  continue: (
    ws: string,
    cid: string,
    body: ReturnType<
      typeof commandBody<{
        expected_work_version: number;
        checkpoint_id: string;
        checkpoint_hash: string;
      }>
    >,
  ) =>
    call<{ id: string; state: string }>(`${conv(ws, cid)}/continue`, {
      method: "POST",
      body,
    }),
};

// ---- B2.5 ----

export interface UploadBody {
  schema_version: "workagent/v1";
  request_id: string;
  command_id: string;
  filename: string;
  mime_type: string;
  content_base64: string;
  sha256: string;
}

export const documentApi = {
  upload: (ws: string, cid: string, body: UploadBody) =>
    call<DocumentDetail>(`${conv(ws, cid)}/documents`, {
      method: "POST",
      body,
    }),
  list: (ws: string, cid: string, signal?: AbortSignal) =>
    call<{ items: DocumentMetadata[] }>(`${conv(ws, cid)}/documents`, {
      signal,
    }),
  get: (ws: string, cid: string, id: string, signal?: AbortSignal) =>
    call<DocumentDetail>(
      `${conv(ws, cid)}/documents/${encodeURIComponent(id)}`,
      { signal },
    ),
  /**
   * The exact retained original through the same-origin proxy. The bytes are
   * checked against the document's own sha256 before anything is saved.
   */
  async original(ws: string, cid: string, doc: DocumentMetadata) {
    const scope = captureScope();
    let res: Response;
    try {
      res = await doFetch(
        `${conv(ws, cid)}/documents/${encodeURIComponent(doc.document_id)}/download`,
        {
          headers: { "X-Workagent-Client": "local-ui", "X-Request-Id": rid() },
          cache: "no-store",
        },
      );
    } catch {
      throw new ApiError({
        code: "transport",
        status: 0,
        message: "Could not reach the local service.",
      });
    }
    if (!res.ok)
      throw new ApiError({
        code: res.status === 404 ? "not_found_or_not_authorized" : "transport",
        status: res.status,
        message: "The original could not be authorized or confirmed.",
      });
    const bytes = new Uint8Array(await res.arrayBuffer());
    assertScope(scope);
    const digest = await sha256Hex(bytes);
    assertScope(scope);
    if (digest !== doc.sha256)
      throw new Error(
        "The original’s digest did not match. Nothing was saved.",
      );
    return new Blob([bytes], { type: doc.mime_type });
  },
};

/**
 * Downloads the exact original. The scope it started in is checked again
 * right before anything is saved, so a page fenced meanwhile saves nothing.
 */
export async function saveOriginal(
  ws: string,
  cid: string,
  doc: DocumentMetadata,
) {
  const scope = captureScope();
  const blob = await documentApi.original(ws, cid, doc);
  assertScope(scope);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = doc.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
