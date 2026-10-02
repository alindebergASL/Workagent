import { describe, it, expect } from "vitest";
import { commandPayloadCache } from "../src/lib/client/command-cache";
describe("canonical command metadata across retries", () => {
  it("does not rebase an ambiguous retry onto a newer work version", async () => {
    const cache = commandPayloadCache();
    let version = 1;
    const build = async () => ({ expected_work_version: version });
    expect(
      await cache("ws:operation", "cmd", { instruction: "same" }, build),
    ).toEqual({ expected_work_version: 1 });
    version = 2;
    expect(
      await cache("ws:operation", "cmd", { instruction: "same" }, build),
    ).toEqual({ expected_work_version: 1 });
    await expect(
      cache("ws:operation", "cmd", { instruction: "changed" }, build),
    ).rejects.toMatchObject({ code: "command_conflict" });
  });
  it("coalesces concurrent metadata construction without automatic HTTP retry", async () => {
    const cache = commandPayloadCache();
    let calls = 0;
    const build = async () => ({ version: ++calls });
    const results = await Promise.all([
      cache("ws", "id", {}, build),
      cache("ws", "id", {}, build),
    ]);
    expect(results).toEqual([{ version: 1 }, { version: 1 }]);
    expect(calls).toBe(1);
  });
});
