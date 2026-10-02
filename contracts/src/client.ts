import createClient from "openapi-fetch";
import type { paths } from "./schema.js";

/** No cookie identity, hardcoded credential, or automatic write retry. */
export function workagentClient(baseUrl: string, bearer: string, requestId: () => string) {
  const client = createClient<paths>({ baseUrl, headers: { Authorization: `Bearer ${bearer}`, "X-Schema-Version": "workagent/v1" }, credentials: "omit" });
  client.use({ onRequest({ request }) {
    request.headers.set("X-Request-Id", requestId());
    return request;
  }});
  return client;
}
export type { components, operations, paths } from "./schema.js";
