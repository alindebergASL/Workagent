/**
 * MOCK HTTP adapter. Routes mirror the provisional contract so the browser
 * talks HTTP exactly as it will to Hermes's API; switching is a base-URL
 * change. Everything under `_control` is test/demo tooling and is refused
 * unless WORKAGENT_MOCK_CONTROL is enabled.
 */
import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { MockError, resolvePrincipal } from "@/lib/mock/service";
import * as svc from "@/lib/mock/service";
import { CONTRACT_SCHEMA_VERSION } from "@/lib/contract/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

function json(body: unknown, status = 200, requestId?: string): NextResponse {
  const res = NextResponse.json(body, { status });
  res.headers.set("x-request-id", requestId ?? randomUUID());
  res.headers.set("x-workagent-contract", CONTRACT_SCHEMA_VERSION);
  res.headers.set("x-workagent-mode", "mock");
  res.headers.set("cache-control", "no-store");
  return res;
}

function errorResponse(err: unknown, requestId: string): NextResponse {
  if (err instanceof MockError) {
    return json(
      {
        error: {
          code: err.code,
          message: err.message,
          request_id: requestId,
          next_action: err.nextAction,
          details: err.details,
        },
      },
      err.status,
      requestId,
    );
  }
  const message = err instanceof Error ? err.message : "Unexpected error";
  return json(
    {
      error: { code: "unsupported_operation", message, request_id: requestId },
    },
    500,
    requestId,
  );
}

function controlEnabled(): boolean {
  return process.env["WORKAGENT_MOCK_CONTROL"] === "1";
}

async function handle(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  if (process.env["NEXT_PUBLIC_WORKAGENT_API_BASE"] !== "/api/mock") {
    return json(
      {
        error: {
          code: "not_found_or_not_authorized",
          message: "This endpoint is unavailable.",
          request_id: requestId,
        },
      },
      404,
      requestId,
    );
  }
  const { path } = await ctx.params;
  const method = req.method;
  const url = new URL(req.url);
  try {
    if (path[0] === "_control") {
      if (!controlEnabled())
        throw new MockError(
          "unsupported_operation",
          403,
          "Mock controls are disabled.",
        );
      const body =
        method === "POST"
          ? ((await req.json().catch(() => ({}))) as Record<string, string>)
          : {};
      switch (path[1]) {
        case "release-proposal":
          return json(
            svc.controlReleaseProposal(String(body["proposal_id"] ?? "")),
            200,
            requestId,
          );
        case "advance":
          return json(
            svc.controlAdvance(String(body["assignment_id"] ?? "")),
            200,
            requestId,
          );
        case "reset":
          return json(svc.controlReset(), 200, requestId);
        case "dump":
          return json(svc.controlDump(), 200, requestId);
        default:
          throw new MockError("unsupported_operation", 404, "Unknown control.");
      }
    }
    if (path[0] === "health")
      return json(
        { ok: true, mode: "mock", contract: CONTRACT_SCHEMA_VERSION },
        200,
        requestId,
      );

    const principal = resolvePrincipal(
      req.headers.get("x-workagent-principal"),
    );

    // GET /workspaces
    if (path[0] === "workspaces" && path.length === 1 && method === "GET")
      return json(svc.listWorkspaces(principal), 200, requestId);
    const ws = path[1];
    if (path[0] !== "workspaces" || !ws)
      throw new MockError("unsupported_operation", 404, "Unknown route.");

    const rest = path.slice(2);
    const readBody = async <T>(): Promise<T> => (await req.json()) as T;

    if (rest[0] === "sources" && rest.length === 1 && method === "GET")
      return json(svc.listSources(principal, ws), 200, requestId);

    if (rest[0] === "assignments") {
      if (rest.length === 1 && method === "GET")
        return json(svc.listAssignments(principal, ws), 200, requestId);
      if (rest.length === 1 && method === "POST") {
        const r = svc.createAssignment(principal, ws, await readBody());
        return json(r.body, r.status, requestId);
      }
      const id = rest[1]!;
      if (rest.length === 2 && method === "GET")
        return json(svc.getAssignment(principal, ws, id), 200, requestId);
      if (rest.length === 3 && rest[2] === "control" && method === "POST") {
        const r = svc.controlAssignment(principal, ws, id, await readBody());
        return json(r.body, r.status, requestId);
      }
      if (rest.length === 3 && rest[2] === "sources" && method === "GET")
        return json(
          svc.getAssignmentSources(principal, ws, id),
          200,
          requestId,
        );
    }

    if (rest[0] === "artifacts" && rest[1]) {
      const id = rest[1];
      if (rest.length === 2 && method === "GET")
        return json(
          svc.getArtifact(
            principal,
            ws,
            id,
            url.searchParams.get("revision_id"),
          ),
          200,
          requestId,
        );
      if (rest.length === 3 && rest[2] === "history" && method === "GET")
        return json(svc.getArtifactHistory(principal, ws, id), 200, requestId);
      if (rest.length === 3 && rest[2] === "revisions" && method === "POST") {
        const r = svc.saveRevision(principal, ws, id, await readBody());
        return json(r.body, r.status, requestId);
      }
      if (
        rest.length === 3 &&
        rest[2] === "request-revision" &&
        method === "POST"
      ) {
        const r = svc.requestRevision(principal, ws, id, await readBody());
        return json(r.body, r.status, requestId);
      }
      if (rest.length === 5 && rest[2] === "proposals" && method === "POST") {
        const pid = rest[3]!;
        if (rest[4] === "accept") {
          const r = svc.acceptProposal(
            principal,
            ws,
            id,
            pid,
            await readBody(),
          );
          return json(r.body, r.status, requestId);
        }
        if (rest[4] === "decline") {
          const r = svc.declineProposal(
            principal,
            ws,
            id,
            pid,
            await readBody(),
          );
          return json(r.body, r.status, requestId);
        }
      }
    }
    throw new MockError("unsupported_operation", 404, "Unknown route.");
  } catch (err) {
    return errorResponse(err, requestId);
  }
}

export const GET = handle;
export const POST = handle;
