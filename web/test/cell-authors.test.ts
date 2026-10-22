import { describe, expect, it } from "vitest";
import {
  cellAt,
  cellAuthors,
  cellChanges,
  changeSummary,
  tableChanges,
  yourValuesChanged,
} from "@/lib/flexible";

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

describe("what a proposal takes away", () => {
  const saved = table("690.00", 6);
  const yours = { [cellAt("lark", "price")]: "human" as const };
  const without = (key: string) => ({
    ...saved,
    fields: saved.fields.filter((f) => f.key !== key),
    rows: saved.rows.map((r) => ({
      ...r,
      cells: r.cells.filter((c) => c.field_key !== key),
    })),
  });
  it("counts removed columns and notes, not only additions", () => {
    const noted = { ...saved, notes: ["Quotes as of Monday.", "Ask Lark."] };
    const c = tableChanges(noted, { ...without("days"), notes: ["Ask Lark."] });
    expect(c).toMatchObject({ dropped: 1, notes: 1, cells: 0 });
    expect(changeSummary(c)).toBe("1 column removed · 1 note removed");
  });
  it("counts the person's own values a proposal changes or removes", () => {
    expect(yourValuesChanged(saved, saved, yours)).toBe(0);
    // Someone else's value changing isn't the person's loss.
    expect(yourValuesChanged(saved, table("690.00", 9), yours)).toBe(0);
    expect(yourValuesChanged(saved, table("700.00", 6), yours)).toBe(1);
    // Gone with its column, or with its row.
    expect(yourValuesChanged(saved, without("price"), yours)).toBe(1);
    expect(yourValuesChanged(saved, { ...saved, rows: [] }, yours)).toBe(1);
  });
});
