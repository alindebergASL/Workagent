/**
 * B3.0b files routes over the generated workagent/v1 client (same instance,
 * scope fencing and unwrap as real-api). The only raw fetch left is the
 * verified binary export download, which has no JSON body to unwrap; it uses
 * the same page-scope fencing. The server-side proxy injects its private
 * local bearer; none reaches JS.
 */
import { client, unwrap, meta, command } from "./real-api";
import { API_BASE } from "./api";
import { ApiError } from "@/lib/contract/errors";
import {
  assertScope,
  boundScope,
  captureScope,
  fenceScope,
  identityUnconfirmed,
  SCOPE_HEADER,
  scopeRefused,
} from "./session-scope";
import type {
  CreateWorkspaceFile,
  EditWorkspaceFile,
  ExportFile,
  ExportManifest,
  FileComparison,
  FileRange,
  FileVersionRef,
  GeneratedBlobRef,
  WorkspaceFile,
  WorkspaceFilePage,
} from "@/lib/files-contract";
import { READ_CHUNK_LIMIT, verifyDownloadedBytes } from "@/lib/files-contract";

/** Exact command envelope. Replaying a command reuses the same stored body. */
export interface CommandEnvelope {
  schema_version: "workagent/v1";
  request_id: string;
  command_id: string;
}

export const envelope = (commandId: string): CommandEnvelope =>
  command(commandId);

export async function listFiles(
  ws: string,
  conversation: string,
  signal?: AbortSignal,
): Promise<WorkspaceFilePage> {
  return unwrap(
    client.GET(
      "/v1/workspaces/{workspace_id}/work-areas/{conversation_id}/files",
      {
        params: {
          path: { workspace_id: ws, conversation_id: conversation },
          header: meta(),
          query: { limit: 100 },
        },
        signal,
      },
    ),
  );
}

export async function createFile(
  ws: string,
  conversation: string,
  body: CreateWorkspaceFile,
): Promise<WorkspaceFile> {
  return unwrap(
    client.POST(
      "/v1/workspaces/{workspace_id}/work-areas/{conversation_id}/files",
      {
        params: { path: { workspace_id: ws, conversation_id: conversation } },
        body,
      },
    ),
  );
}

/** One bounded chunk of an exact saved version, never the moving head. */
export async function readVersion(
  ws: string,
  fileId: string,
  versionId: string,
  sha256: string,
  offset = 0,
  signal?: AbortSignal,
): Promise<FileRange> {
  return unwrap(
    client.GET(
      "/v1/workspaces/{workspace_id}/files/{file_id}/versions/{version_id}",
      {
        params: {
          path: {
            workspace_id: ws,
            file_id: fileId,
            version_id: versionId,
          },
          header: meta(),
          query: { sha256, offset, limit: READ_CHUNK_LIMIT },
        },
        signal,
      },
    ),
  );
}

/**
 * Human exact-base save: a new version appended on top of the exact base
 * version and bytes the edit started from. The response's `current` is the
 * accepted version's stable ref.
 */
export async function editFile(
  ws: string,
  fileId: string,
  body: EditWorkspaceFile,
): Promise<WorkspaceFile> {
  return unwrap(
    client.POST("/v1/workspaces/{workspace_id}/files/{file_id}/versions", {
      params: { path: { workspace_id: ws, file_id: fileId } },
      body,
    }),
  );
}

export async function compareVersions(
  ws: string,
  fileId: string,
  left: FileVersionRef,
  right: FileVersionRef,
  signal?: AbortSignal,
): Promise<FileComparison> {
  return unwrap(
    client.GET("/v1/workspaces/{workspace_id}/files/{file_id}/compare", {
      params: {
        path: { workspace_id: ws, file_id: fileId },
        header: meta(),
        query: {
          left_version_id: left.version_id,
          left_sha256: left.sha256,
          right_version_id: right.version_id,
          right_sha256: right.sha256,
        },
      },
      signal,
    }),
  );
}

export async function requestExport(
  ws: string,
  fileId: string,
  body: ExportFile,
): Promise<ExportManifest> {
  return unwrap(
    client.POST("/v1/workspaces/{workspace_id}/files/{file_id}/exports", {
      params: { path: { workspace_id: ws, file_id: fileId } },
      body,
    }),
  );
}

/**
 * Fetches export bytes and verifies exact length + SHA-256 against the
 * manifest before anything is offered to the browser. A mismatch throws and
 * nothing is saved; the download is never silently retried.
 */
export async function downloadVerifiedExport(
  ws: string,
  exportId: string,
  blob: GeneratedBlobRef,
): Promise<ArrayBuffer> {
  const url = `${API_BASE}/v1/workspaces/${encodeURIComponent(ws)}/exports/${encodeURIComponent(exportId)}/download`;
  const scope = captureScope();
  const bound = boundScope();
  if (!bound) throw scopeRefused();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "x-schema-version": "workagent/v1",
        "x-request-id": crypto.randomUUID(),
        "X-Workagent-Client": "local-ui",
        [SCOPE_HEADER]: bound,
      },
    });
  } catch {
    throw new ApiError({
      code: "transport",
      status: 0,
      message: "Could not reach the local service.",
    });
  }
  if (identityUnconfirmed(response)) {
    fenceScope();
    void response.body?.cancel().catch(() => undefined);
    throw scopeRefused();
  }
  if (boundScope() !== bound) {
    void response.body?.cancel().catch(() => undefined);
    throw scopeRefused();
  }
  if (response.status === 401) fenceScope();
  if (!response.ok)
    throw new ApiError({
      code: "transport",
      status: response.status,
      message: "The export could not be downloaded.",
    });
  const bytes = await response.arrayBuffer();
  assertScope(scope);
  const problem = await verifyDownloadedBytes(bytes, blob);
  if (problem)
    // Locally raised integrity refusal (status 0): shown verbatim to the user.
    throw new ApiError({
      code: "validation_error",
      status: 0,
      message: problem,
    });
  return bytes;
}
