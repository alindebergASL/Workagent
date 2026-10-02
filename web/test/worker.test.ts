import { describe, expect, it } from "vitest";
import {
  analyzeIntake,
  buildPlanBody,
  buildRecommendation,
} from "@/lib/mock/worker";
import { diffBlocks } from "@/lib/diff";

describe("intake analysis", () => {
  it("counts the union of affected cases once", () => {
    const a = analyzeIntake([
      { id: "A", owner_recorded: false, next_action_recorded: false },
      { id: "B", owner_recorded: true, next_action_recorded: false },
      { id: "C", owner_recorded: false, next_action_recorded: true },
      { id: "D", owner_recorded: true, next_action_recorded: true },
    ]);
    expect(a.affected).toEqual(["A", "B", "C"]);
    expect(a.both).toEqual(["A"]);
  });

  it("derives the fixture recommendation from the rows, not a constant", () => {
    const rec = buildRecommendation(["SG-F2", "SG-F3"]);
    expect(rec.evidence[0]).toMatch(/4 of 8 cases \(50%\)/);
    expect(rec.uncertainty.length).toBeGreaterThan(0);
    const none = buildRecommendation(["SG-F3"]);
    expect(none.evidence).toEqual([]);
  });

  it("carries the protected note verbatim when the working plan is selected", () => {
    const body = buildPlanBody(["SG-F2", "SG-F3", "SG-F7"]);
    expect(body.find((b) => b.id === "pl-protected")?.text).toBe(
      "Keep Wednesday 14:00–15:00 for method drafting.",
    );
    expect(buildPlanBody(["SG-F2"]).some((b) => b.id === "pl-protected")).toBe(
      false,
    );
  });
});

describe("diffBlocks", () => {
  it("marks added and removed blocks", () => {
    const cur = [
      { id: "1", kind: "paragraph" as const, text: "a" },
      { id: "2", kind: "paragraph" as const, text: "b" },
    ];
    const prop = [
      { id: "1", kind: "paragraph" as const, text: "a" },
      { id: "x", kind: "paragraph" as const, text: "c" },
    ];
    expect(
      diffBlocks(cur, prop).map((o) => `${o.type}:${o.block.text}`),
    ).toEqual(["same:a", "removed:b", "added:c"]);
  });
});
