/**
 * Test-only session scope (A14). Product code never falls back to this: it's
 * bound only here, through the same probe a real page uses.
 */
import { createHmac } from "node:crypto";
import { vi } from "vitest";
import { __resetScopeForTests, probeSession } from "@/lib/client/session-scope";

export const TEST_SCOPE = "c".repeat(64);
export const TEST_BACKEND_SCOPE = "d".repeat(64);
const PREFIX = `workagent:scope:v1:${TEST_SCOPE}:`;
/** The raw storage key a scoped record is kept under in tests. */
export const scopedKey = (key: string) => `${PREFIX}${key}`;

export async function bindTestScope() {
  __resetScopeForTests();
  await probeSession(
    vi.fn(async () =>
      Response.json({ principal_id: "test-human", scope_id: TEST_SCOPE }),
    ) as unknown as typeof fetch,
  );
}

/** Proxy tests: the browser scope a page would present for this backend. */
export const proxyScope = (bearer: string, backend: string) =>
  createHmac("sha256", bearer)
    .update(`workagent-web-scope/v1\n${backend}\n${TEST_BACKEND_SCOPE}`)
    .digest("hex");

/** Proxy tests: answers the backend session probe, delegating the rest. */
export const withBackendSession =
  (rest: (...a: Parameters<typeof fetch>) => Promise<Response>) =>
  async (...a: Parameters<typeof fetch>) =>
    String(a[0]).endsWith("/v1/session")
      ? Response.json({
          principal_id: "test-human",
          scope_id: TEST_BACKEND_SCOPE,
        })
      : rest(...a);
