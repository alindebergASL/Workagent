import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
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
        if (size > 256000) {
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
  try {
    const upstream = await fetch(
      `${backend}/${path.join("/")}${request.nextUrl.search}`,
      {
        method: request.method,
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
          "X-Schema-Version": "workagent/v1",
          "X-Request-Id":
            request.headers.get("x-request-id") ?? crypto.randomUUID(),
        },
        body: body as BodyInit | undefined,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...noStore,
        "Content-Type": "application/json",
        "X-Request-Id": upstream.headers.get("x-request-id") ?? "local-proxy",
      },
    });
  } catch {
    return error(
      502,
      "action_unresolved",
      "Could not confirm the service response. Inspect saved state before retrying a write.",
    );
  }
}
export const GET = route;
export const POST = route;
