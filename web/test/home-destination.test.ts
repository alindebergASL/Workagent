import { describe, expect, it } from "vitest";
import { homeDestination } from "@/lib/home-destination";
import { limiter } from "@/lib/client/limit";

const openable = [
  { id: "historical", kind: "shared" },
  { id: "overnight", kind: "shared" },
];

describe("homeDestination", () => {
  it("uses the workspace the address names, not the first one", () => {
    expect(homeDestination({ named: "overnight", openable })).toBe("overnight");
  });
  it("prefers the address over a remembered choice", () => {
    expect(
      homeDestination({
        named: "overnight",
        remembered: "historical",
        openable,
      }),
    ).toBe("overnight");
  });
  it("falls back from a workspace this person can't open", () => {
    expect(
      homeDestination({ named: "gone", remembered: "overnight", openable }),
    ).toBe("overnight");
    expect(homeDestination({ named: "gone", openable })).toBe("historical");
  });
  it("defaults to the personal workspace", () => {
    expect(
      homeDestination({
        openable: [...openable, { id: "mine", kind: "personal" }],
      }),
    ).toBe("mine");
  });
  it("is null when nothing can be opened", () => {
    expect(homeDestination({ named: "x", openable: [] })).toBeNull();
  });
});

describe("limiter", () => {
  it("never runs more than its limit at once and keeps every result", async () => {
    const limit = limiter(2);
    let running = 0;
    let peak = 0;
    const read = (v: number) =>
      limit(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return v;
      });
    expect(await Promise.all([1, 2, 3, 4, 5].map(read))).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(peak).toBe(2);
  });
  it("lets the next read start after a failure", async () => {
    const limit = limiter(1);
    const failed = limit(() => Promise.reject(new Error("no")));
    const ok = limit(async () => "yes");
    await expect(failed).rejects.toThrow("no");
    expect(await ok).toBe("yes");
  });
});
