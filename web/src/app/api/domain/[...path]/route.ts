import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
const SCOPE = /^[a-f0-9]{64}$/;
type Session = { principal_id?: unknown; scope_id?: unknown };
/**
 * The browser's scope: keyed by the private bearer over the backend endpoint
 * and the backend's own scope, so a changed credential, database, principal
 * or endpoint all give a different scope, and none of them is revealed.
 */
const browserScope = (bearer: string, backend: string, scope: string) =>
  createHmac("sha256", bearer)
    .update(`workagent-web-scope/v1\n${backend}\n${scope}`)
    .digest("hex");
function error(status: number, code: string, message: string) {
  return Response.json(
    {
      code,
      message,
      request_id: "local-proxy",
      next_action: "Check the local service configuration.",
      details: {},
    },
    { status, headers: noStore },
  );
}
/**
 * Identity couldn't be confirmed (session preflight failed, or the page's
 * scope is absent or stale) and nothing was forwarded. The marker tells the
 * browser to fence the page at once; an ordinary upstream 5xx never has it.
 */
function unconfirmed(status: number, code: string, message: string) {
  const res = error(status, code, message);
  res.headers.set("X-Workagent-Identity", "unconfirmed");
  return res;
}
async function route(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const origin = process.env.WORKAGENT_WEB_ORIGIN ?? "http://127.0.0.1:3000";
  const backend = process.env.WORKAGENT_BACKEND_URL ?? "http://127.0.0.1:8000";
  const bearer = process.env.LOCAL_BEARER_TOKEN;
  if (
    process.env.LOCAL_TEST_MODE !== "true" ||
    !bearer ||
    bearer.length < 32 ||
    !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin) ||
    !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(backend)
  )
    return error(
      503,
      "connection_required",
      "Explicit local fixture configuration is required.",
    );
  // Defend loopback identity against cross-site requests and DNS rebinding.
  if (
    request.headers.get("host") !== new URL(origin).host ||
    request.headers.get("x-workagent-client") !== "local-ui" ||
    (request.headers.get("origin") &&
      request.headers.get("origin") !== origin) ||
    (request.headers.get("sec-fetch-site") &&
      !["same-origin", "none"].includes(request.headers.get("sec-fetch-site")!))
  )
    return error(
      403,
      "not_found_or_not_authorized",
      "This local endpoint is unavailable.",
    );
  const { path } = await params;
  // A14: which authenticated scope this proxy serves right now. Asked afresh
  // for every request (no cache); any failure fails closed.
  const session = async (): Promise<
    { principal_id: string; backend: string; browser: string } | Response
  > => {
    try {
      const res = await fetch(`${backend}/v1/session`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "X-Schema-Version": "workagent/v1",
          "X-Request-Id": crypto.randomUUID(),
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 401 || res.status === 403)
        return unconfirmed(
          401,
          "unauthenticated",
          "Access couldn’t be confirmed.",
        );
      const body = (res.ok ? await res.json() : null) as Session | null;
      if (
        typeof body?.principal_id !== "string" ||
        !body.principal_id ||
        typeof body.scope_id !== "string" ||
        !SCOPE.test(body.scope_id)
      )
        throw new Error("session");
      return {
        principal_id: body.principal_id,
        backend: body.scope_id,
        browser: browserScope(bearer, backend, body.scope_id),
      };
    } catch {
      return unconfirmed(
        503,
        "connection_required",
        "Access couldn’t be confirmed.",
      );
    }
  };
  if (
    request.method === "GET" &&
    path.length === 2 &&
    path[0] === "v1" &&
    path[1] === "session"
  ) {
    const s = await session();
    if (s instanceof Response) return s;
    return Response.json(
      { principal_id: s.principal_id, scope_id: s.browser },
      { status: 200, headers: noStore },
    );
  }
  // Every other request names the scope its page was bound to. The scope is
  // a fence, not authorization: an absent or stale one is refused before
  // anything is forwarded, so a page never reads or writes under access it
  // didn't start with.
  const expected = request.headers.get("x-workagent-scope") ?? "";
  const stale = () =>
    unconfirmed(401, "unauthenticated", "Access for this page changed.");
  if (!SCOPE.test(expected)) return stale();
  if (
    path[0] !== "v1" ||
    path[1] !== "workspaces" ||
    path.some(
      (p) => !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(p) || p === "..",
    )
  )
    return error(
      404,
      "not_found_or_not_authorized",
      "This item is unavailable.",
    );
  // The event stream stays open; it ends when the browser disconnects (or
  // switches conversation), never on a fixed timer. The bearer is added here
  // on every (re)connection, so each reconnect is authenticated afresh.
  const stream =
    request.method === "GET" &&
    path.length === 5 &&
    path[3] === "events" &&
    path[4] === "stream";
  // B2.5: a document upload carries one original (<= 5 MiB) as canonical
  // base64 inside the normal command envelope; only that route gets the
  // larger body bound and the parser's longer confirmation window.
  const upload =
    request.method === "POST" &&
    path.length === 6 &&
    path[3] === "conversations" &&
    path[5] === "documents";
  const original =
    request.method === "GET" &&
    path.length === 8 &&
    path[3] === "conversations" &&
    path[5] === "documents" &&
    path[7] === "download";
  // Exactly /v1/workspaces/:ws/exports/:exportId/download: the four text
  // export formats, forwarded as the exact bytes the backend produced.
  const exportDownload =
    request.method === "GET" &&
    path.length === 6 &&
    path[3] === "exports" &&
    path[5] === "download";
  const maxBody = upload ? Math.ceil((5 * 1024 * 1024) / 3) * 4 + 4096 : 256000;
  let body: Uint8Array | undefined;
  if (request.method === "POST") {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return error(422, "validation_error", "JSON required.");
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBody) {
          await reader.cancel();
          return error(422, "validation_error", "Request too large.");
        }
        chunks.push(value);
      }
    body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
  }
  const current = await session();
  if (current instanceof Response) return current;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(current.browser)))
    return stale();
  // A stream has no overall limit, but it must start within 15 seconds: a
  // backend that accepts and never answers would otherwise hold the page on
  // "connecting" with no fallback. Leaving the page closes it upstream.
  let opening: ReturnType<typeof setTimeout> | undefined;
  const streamSignal = (() => {
    if (!stream) return undefined;
    const opened = new AbortController();
    opening = setTimeout(() => opened.abort(), 15000);
    request.signal.addEventListener("abort", () => opened.abort(), {
      once: true,
    });
    return opened.signal;
  })();
  try {
    const upstream = await fetch(
      `${backend}/${path.join("/")}${request.nextUrl.search}`,
      {
        method: request.method,
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
          ...(stream ? { Accept: "text/event-stream" } : {}),
          "X-Schema-Version": "workagent/v1",
          "X-Request-Id":
            request.headers.get("x-request-id") ?? crypto.randomUUID(),
          // The backend refuses if its scope changed since the check above.
          "X-Workagent-Scope": current.backend,
        },
        body: body as BodyInit | undefined,
        cache: "no-store",
        redirect: "error",
        signal: streamSignal ?? AbortSignal.timeout(upload ? 45000 : 15000),
      },
    );
    clearTimeout(opening);
    if (
      stream &&
      upstream.ok &&
      upstream.headers.get("content-type")?.startsWith("text/event-stream")
    )
      return new Response(upstream.body, {
        status: 200,
        headers: {
          ...noStore,
          "Content-Type": "text/event-stream",
          "X-Accel-Buffering": "no",
          "X-Request-Id": upstream.headers.get("x-request-id") ?? "local-proxy",
        },
      });
    if (original && upstream.ok) {
      // Exact original bytes, never re-encoded as JSON. The digest is computed
      // here over what is forwarded so the browser can compare it with the
      // document's own sha256 before saving.
      const mime = upstream.headers.get("content-type")?.split(";")[0] ?? "";
      const disposition = upstream.headers.get("content-disposition") ?? "";
      const bytes = new Uint8Array(await upstream.arrayBuffer());
      if (
        ![
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ].includes(mime) ||
        !/^attachment; filename="[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.(pdf|docx|xlsx)"$/.test(
          disposition,
        ) ||
        bytes.length === 0 ||
        bytes.length > 5 * 1024 * 1024
      )
        return error(
          502,
          "action_unresolved",
          "Download metadata was not safe or complete.",
        );
      const digest = Buffer.from(
        await crypto.subtle.digest("SHA-256", bytes),
      ).toString("hex");
      return new Response(bytes, {
        status: 200,
        headers: {
          ...noStore,
          "Content-Type": mime,
          "Content-Disposition": disposition,
          "X-Content-SHA256": digest,
          "X-Content-Type-Options": "nosniff",
          "X-Request-Id": upstream.headers.get("x-request-id") ?? "local-proxy",
        },
      });
    }
    if (exportDownload && upstream.ok) {
      // Exact export bytes forwarded unchanged and bounded — never re-encoded,
      // and a JSON export is bytes here, never parsed as a DTO. The digest is
      // computed over what is forwarded so the browser can compare it with the
      // export manifest's own sha256 before saving.
      const mime = upstream.headers.get("content-type")?.split(";")[0] ?? "";
      const disposition = upstream.headers.get("content-disposition") ?? "";
      const ext =
        /^attachment; filename="[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(txt|md|markdown|csv|json|docx|xlsx|pdf|png)"$/.exec(
          disposition,
        )?.[1];
      // Exact extension → MIME pairs; anything else (including a binary
      // format under a text MIME or vice versa) is refused, never sniffed.
      const exportMime: Record<string, string> = {
        txt: "text/plain",
        md: "text/markdown",
        markdown: "text/markdown",
        csv: "text/csv",
        json: "application/json",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        pdf: "application/pdf",
        png: "image/png",
      };
      const bytes = new Uint8Array(await upstream.arrayBuffer());
      if (
        !ext ||
        exportMime[ext] !== mime ||
        bytes.length === 0 ||
        bytes.length > 1024 * 1024
      )
        return error(
          502,
          "action_unresolved",
          "Download metadata was not safe or complete.",
        );
      const digest = Buffer.from(
        await crypto.subtle.digest("SHA-256", bytes),
      ).toString("hex");
      const declared = upstream.headers.get("x-content-sha256");
      if (declared !== null && declared !== digest)
        return error(
          502,
          "action_unresolved",
          "The download did not match its declared digest.",
        );
      return new Response(bytes, {
        status: 200,
        headers: {
          ...noStore,
          "Content-Type": mime,
          "Content-Disposition": disposition,
          "Content-Length": String(bytes.length),
          "X-Content-SHA256": digest,
          "X-Content-Type-Options": "nosniff",
          "X-Request-Id": upstream.headers.get("x-request-id") ?? "local-proxy",
        },
      });
    }
    const download = path.at(-1) === "download" && upstream.ok;
    const mime = upstream.headers.get("content-type")?.split(";")[0];
    const disposition = upstream.headers.get("content-disposition") ?? "";
    const digest = upstream.headers.get("x-content-sha256") ?? "";
    if (
      download &&
      (!mime ||
        !["text/csv", "text/plain", "application/wasm-text"].includes(mime) ||
        !/^attachment; filename="[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(csv|wat|txt)"$/.test(
          disposition,
        ) ||
        !/^[a-f0-9]{64}$/.test(digest))
    )
      return error(
        502,
        "action_unresolved",
        "Download metadata was not safe or complete.",
      );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...noStore,
        "Content-Type": download ? mime! : "application/json",
        ...(download
          ? {
              "Content-Disposition": disposition,
              "X-Content-SHA256": digest,
              "X-Content-Type-Options": "nosniff",
            }
          : {}),
        "X-Request-Id": upstream.headers.get("x-request-id") ?? "local-proxy",
      },
    });
  } catch {
    clearTimeout(opening);
    return error(
      502,
      "action_unresolved",
      "Could not confirm the service response. Inspect saved state before retrying a write.",
    );
  }
}
export const GET = route;
export const POST = route;
