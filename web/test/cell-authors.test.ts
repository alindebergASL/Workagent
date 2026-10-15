import { describe, expect, it } from "vitest";
import { cellAt, cellAuthors, cellChanges } from "@/lib/flexible";

type Rev = Parameters<typeof cellAuthors>[1][number];
const table = (price: string, days: number) => ({
  kind: "structured_table" as const,
  version: "structured-table/v1" as const,
  title: "Quotes",
  notes: [],
  fields: [
    { key: "name", label: "Supplier", type: "text" as const, editable: true },
    {
      key: "price",
      label: "Quote",
      type: "decimal" as const,
      editable: true,
      unit: "EUR",
      scale: 2,
    },
    {
      key: "days",
      label: "Delivery",
      type: "integer" as const,
      editable: true,
    },
  ],
  rows: [
    {
      row_id: "lark",
      cells: [
        { field_key: "name", value: "Lark & Co" },
        { field_key: "price", value: price },
        { field_key: "days", value: days },
      ],
    },
  ],
});
const rev = (
  id: string,
  author: "human" | "worker",
  parent: string | null,
  body: ReturnType<typeof table>,
): Rev =>
  ({
    id,
    artifact_id: "a",
    author_id: author,
    author_kind: author,
    body,
    body_hash: id.padEnd(64, "0"),
    parent_revision_id: parent,
    revision_number: 1,
    source_dependencies: [],
  }) as unknown as Rev;

describe("who set each value", () => {
  const r1 = rev("r1", "worker", null, table("715.00", 6));
  const r2 = rev("r2", "human", "r1", table("690.00", 6));
  it("is whoever first saved it as it is now", () => {
    const a = cellAuthors(r2, [r1, r2]);
    expect(a[cellAt("lark", "price")]).toBe("human");
    expect(a[cellAt("lark", "days")]).toBe("worker");
    expect(a[cellAt("lark", "name")]).toBe("worker");
  });
  it("is unknown when the history doesn't reach where it started", () => {
    expect(cellAuthors(r2, [r2])).toEqual({});
  });
});

describe("what a proposed table changes", () => {
  it("lists each changed value, saved to proposed, by row and field", () => {
    expect(cellChanges(table("690.00", 6), table("700.00", 8))).toEqual([
      expect.objectContaining({
        row: "Lark & Co",
        field: "Quote (EUR)",
        before: "690.00",
        after: "700.00",
      }),
      expect.objectContaining({
        field: "Delivery",
        before: "6",
        after: "8",
      }),
    ]);
  });
  it("lists nothing when only rows are added", () => {
    const more = table("690.00", 6);
    more.rows.push({ ...more.rows[0]!, row_id: "north" });
    expect(cellChanges(table("690.00", 6), more)).toEqual([]);
  });
});
