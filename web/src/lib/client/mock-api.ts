/**
 * HTTP client adapter. REPLACEABLE: when Hermes publishes the generated
 * client, the functions here become thin wrappers over it. Components only
 * depend on this module and the contract types.
 */
import { ApiError } from "@/lib/contract/errors";
import type {
  Artifact,
  ArtifactHistory,
  Assignment,
  AssignmentSummary,
  ControlAssignmentCommand,
  ControlAssignmentResult,
  CreateAssignmentCommand,
  CreateAssignmentResult,
  ErrorEnvelope,
  ListResult,
  ProposalDecisionCommand,
  ProposalDecisionResult,
  RequestRevisionCommand,
  RequestRevisionResult,
  SaveRevisionCommand,
  SaveRevisionResult,
  SourceDetail,
  Workspace,
} from "@/lib/contract/types";

export const API_BASE =
  process.env["NEXT_PUBLIC_WORKAGENT_API_BASE"] ?? "/api/mock";
export const API_MODE: "mock" | "real" = API_BASE.includes("/api/mock")
  ? "mock"
  : "real";
/** Provisional test identity header until Hermes's session boundary exists. */
export const PRINCIPAL =
  process.env["NEXT_PUBLIC_WORKAGENT_PRINCIPAL"] ?? "alex";

export function newCommandId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return `cmd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        "x-workagent-principal": PRINCIPAL,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError({
      code: "transport",
      status: 0,
      message: "Network request failed.",
    });
  }
  const requestId = res.headers.get("x-request-id");
  if (res.ok) {
    return (await res.json()) as T;
  }
  let envelope: ErrorEnvelope | null = null;
  try {
    envelope = (await res.json()) as ErrorEnvelope;
  } catch {
    envelope = null;
  }
  if (envelope?.error?.code) {
    throw new ApiError({
      code: envelope.error.code,
      status: res.status,
      message: envelope.error.message,
      requestId: envelope.error.request_id ?? requestId,
      nextAction: envelope.error.next_action ?? null,
      details: envelope.error.details ?? null,
    });
  }
  throw new ApiError({
    code: res.status === 401 ? "unauthenticated" : "transport",
    status: res.status,
    message: `Request failed (${res.status}).`,
    requestId,
  });
}

export const api = {
  listWorkspaces: (signal?: AbortSignal) =>
    request<ListResult<Workspace>>("GET", "/workspaces", undefined, signal),
  listSources: (ws: string, signal?: AbortSignal) =>
    request<ListResult<SourceDetail>>(
      "GET",
      `/workspaces/${ws}/sources`,
      undefined,
      signal,
    ),
  listAssignments: (ws: string, signal?: AbortSignal) =>
    request<ListResult<AssignmentSummary>>(
      "GET",
      `/workspaces/${ws}/assignments`,
      undefined,
      signal,
    ),
  getAssignment: (ws: string, id: string, signal?: AbortSignal) =>
    request<Assignment>(
      "GET",
      `/workspaces/${ws}/assignments/${id}`,
      undefined,
      signal,
    ),
  getAssignmentSources: (ws: string, id: string, signal?: AbortSignal) =>
    request<ListResult<SourceDetail>>(
      "GET",
      `/workspaces/${ws}/assignments/${id}/sources`,
      undefined,
      signal,
    ),
  createAssignment: (ws: string, cmd: CreateAssignmentCommand) =>
    request<CreateAssignmentResult>(
      "POST",
      `/workspaces/${ws}/assignments`,
      cmd,
    ),
  controlAssignment: (ws: string, id: string, cmd: ControlAssignmentCommand) =>
    request<ControlAssignmentResult>(
      "POST",
      `/workspaces/${ws}/assignments/${id}/control`,
      cmd,
    ),
  getArtifact: (
    ws: string,
    id: string,
    revisionId?: string | null,
    signal?: AbortSignal,
  ) =>
    request<Artifact>(
      "GET",
      `/workspaces/${ws}/artifacts/${id}${revisionId ? `?revision_id=${encodeURIComponent(revisionId)}` : ""}`,
      undefined,
      signal,
    ),
  getArtifactHistory: (ws: string, id: string, signal?: AbortSignal) =>
    request<ArtifactHistory>(
      "GET",
      `/workspaces/${ws}/artifacts/${id}/history`,
      undefined,
      signal,
    ),
  saveRevision: (ws: string, id: string, cmd: SaveRevisionCommand) =>
    request<SaveRevisionResult>(
      "POST",
      `/workspaces/${ws}/artifacts/${id}/revisions`,
      cmd,
    ),
  requestRevision: (ws: string, id: string, cmd: RequestRevisionCommand) =>
    request<RequestRevisionResult>(
      "POST",
      `/workspaces/${ws}/artifacts/${id}/request-revision`,
      cmd,
    ),
  acceptProposal: (
    ws: string,
    id: string,
    pid: string,
    cmd: ProposalDecisionCommand,
  ) =>
    request<ProposalDecisionResult>(
      "POST",
      `/workspaces/${ws}/artifacts/${id}/proposals/${pid}/accept`,
      cmd,
    ),
  declineProposal: (
    ws: string,
    id: string,
    pid: string,
    cmd: ProposalDecisionCommand,
  ) =>
    request<ProposalDecisionResult>(
      "POST",
      `/workspaces/${ws}/artifacts/${id}/proposals/${pid}/decline`,
      cmd,
    ),
};
