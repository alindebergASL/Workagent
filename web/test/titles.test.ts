import { describe, expect, it } from "vitest";
import { readableTitle } from "../src/lib/titles";

describe("readableTitle", () => {
  it("reads identifier-like words as words", () => {
    expect(readableTitle("collected_litres tool")).toBe(
      "Collected litres tool",
    );
    expect(readableTitle("Roof_Area calculator")).toBe("Roof area calculator");
  });
  it("capitalises an all-lowercase first word only", () => {
    expect(readableTitle("total tool")).toBe("Total tool");
    expect(readableTitle("a")).toBe("A");
  });
  it("leaves other titles exactly as written", () => {
    for (const t of [
      "iPhone plan",
      "Draft venue comparison",
      "Q3 – rota",
      "3 options",
    ])
      expect(readableTitle(t)).toBe(t);
  });
});
