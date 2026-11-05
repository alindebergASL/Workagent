import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/client/api");
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each([undefined, "0", "1"])(
  "real client exposes natural message fields without the obsolete build flag %s",
  async (flag) => {
    vi.resetModules();
    vi.doMock("@/lib/client/api", () => ({ API_MODE: "real" }));
    vi.stubEnv("NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION", flag);
    const { CAPABILITIES } = await import("@/lib/client/capabilities");
    expect(CAPABILITIES.naturalAdmission).toBe(true);
    expect(CAPABILITIES.conversation).toBe(true);
  },
);

it("never advertises unsupported real operations in mock mode", async () => {
  vi.resetModules();
  vi.doMock("@/lib/client/api", () => ({ API_MODE: "mock" }));
  vi.stubEnv("NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION", "1");
  const { CAPABILITIES } = await import("@/lib/client/capabilities");
  expect(CAPABILITIES).toEqual({
    conversation: false,
    naturalAdmission: false,
  });
});
