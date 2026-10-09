import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addRow,
  bindingStates,
  canRemoveRow,
  cellValue,
  changeSummary,
  fieldHeading,
  flexibleKind,
  formatCell,
  isEmptyPayload,
  notesFrom,
  parseCell,
  rebind,
  removeRow,
  rowName,
  setCell,
  tableChanges,
  tableCsv,
  viewActionRequest,
  type CustomView,
  type StructuredTable,
  type TableField,
} from "../src/lib/flexible";
import { isProduct } from "../src/lib/client/products";
import { draftAware } from "../src/lib/client/real-api";

// Real model-created synthetic work retained by the backend owner (#13).
const evidence = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../evidence/flexible-work-13/${name}`, import.meta.url),
      "utf8",
    ),
  ).revision.body;
const venues = evidence("venues-current.json") as StructuredTable;
const view = evidence("custom-view.json") as CustomView;

const field = (over: Partial<TableField>): TableField => ({
  key: "f",
  label: "F",
  type: "text",
  editable: true,
  unit: null,
  scale: null,
  enum: null,
  ...over,
});

describe("self-describing work", () => {
  it("recognises shapes by what they declare, keeping older kinds apart", () => {
    expect(flexibleKind(venues)).toBe("structured_table");
    expect(flexibleKind(view)).toBe("custom_view");
    expect(
      flexibleKind({
        title: "Notes",
        blocks: [{ block_id: "a", kind: "paragraph", text: "x" }],
      }),
    ).toBe("document");
    const legacy = {
      kind: "table" as const,
      title: "t",
      columns: [],
      rows: [],
      source_csv: "",
      rounding: "ROUND_HALF_UP" as const,
    };
    expect(flexibleKind(legacy as never)).toBeNull();
    expect(isProduct(legacy as never)).toBe(true);
    expect(isProduct(venues)).toBe(false);
    expect(isProduct(view)).toBe(false);
  });

  it("reads cells by field key and type, never by position", () => {
    const cost = venues.fields.find((f) => f.key === "hire_cost")!;
    expect(fieldHeading(cost)).toBe("Hire cost (supplied fact) (GBP)");
    const shuffled = {
      ...venues.rows[0]!,
      cells: [...venues.rows[0]!.cells].reverse(),
    };
    expect(cellValue(shuffled, "hire_cost")).toBe(
      cellValue(venues.rows[0]!, "hire_cost"),
    );
    expect(formatCell(field({ type: "boolean" }), true)).toBe("Yes");
    expect(formatCell(field({ type: "boolean" }), false)).toBe("No");
    expect(formatCell(field({ type: "integer" }), null)).toBe("—");
    expect(formatCell(field({ type: "integer" }), 0)).toBe("0");
  });

  it("parses typed input with the service's own bounds", () => {
    const dec = field({ type: "decimal", scale: 2 });
    expect(parseCell(dec, "350")).toEqual({ value: "350.00" });
    expect(parseCell(dec, " 12.5 ")).toEqual({ value: "12.50" });
    expect(parseCell(dec, "007.1")).toEqual({ value: "7.10" });
    expect(parseCell(dec, "-0")).toEqual({ value: "0.00" });
    expect(parseCell(dec, "1.234")).toHaveProperty("error");
    expect(parseCell(dec, "1e3")).toHaveProperty("error");
    expect(parseCell(dec, "1".repeat(16))).toHaveProperty("error");
    expect(parseCell(field({ type: "decimal", scale: 0 }), "4")).toEqual({
      value: "4",
    });
    const int = field({ type: "integer" });
    expect(parseCell(int, "-42")).toEqual({ value: -42 });
    expect(parseCell(int, "4.2")).toHaveProperty("error");
    expect(parseCell(int, "9007199254740992")).toHaveProperty("error");
    expect(parseCell(int, "")).toEqual({ value: null });
    const yes = field({ type: "boolean" });
    expect(parseCell(yes, "yes")).toEqual({ value: true });
    expect(parseCell(yes, "no")).toEqual({ value: false });
    expect(parseCell(yes, "maybe")).toHaveProperty("error");
    const choice = field({ type: "enum", enum: ["Low", "High"] });
    expect(parseCell(choice, "High")).toEqual({ value: "High" });
    expect(parseCell(choice, "Medium")).toHaveProperty("error");
    expect(parseCell(field({}), "  keep spaces ")).toEqual({
      value: "  keep spaces ",
    });
    expect(parseCell(field({}), "x".repeat(2001))).toHaveProperty("error");
  });

  it("edits keep row and field identities", () => {
    const row = venues.rows[1]!.row_id;
    const edited = setCell(venues, row, "hire_cost", "199.00");
    expect(edited.rows.map((r) => r.row_id)).toEqual(
      venues.rows.map((r) => r.row_id),
    );
    expect(cellValue(edited.rows[1]!, "hire_cost")).toBe("199.00");
    expect(venues.rows[1]!.cells).not.toBe(edited.rows[1]!.cells);
    const added = addRow(edited, "row-new");
    expect(added.rows.at(-1)!.cells.map((c) => c.field_key)).toEqual(
      venues.fields.map((f) => f.key),
    );
    expect(added.rows.at(-1)!.cells.every((c) => c.value === null)).toBe(true);
    expect(changeSummary(tableChanges(venues, added))).toBe(
      "1 value changed · 1 row added",
    );
    expect(changeSummary(tableChanges(venues, venues))).toBe(
      "No changes to the values",
    );
    expect(changeSummary(tableChanges(venues, removeRow(venues, row)))).toBe(
      "1 row removed",
    );
  });

  it("never offers to delete a saved row that has read-only cells", () => {
    const locked = {
      ...venues,
      fields: venues.fields.map((f, i) =>
        i === 0 ? { ...f, editable: false } : f,
      ),
    };
    const row = venues.rows[0]!.row_id;
    expect(canRemoveRow(venues, venues, row)).toBe(true);
    expect(canRemoveRow(locked, locked, row)).toBe(false);
    const grown = addRow(locked, "row-new");
    expect(canRemoveRow(locked, grown, "row-new")).toBe(true);
  });

  it("exports saved cells as CSV without spreadsheet formulas", () => {
    const t: StructuredTable = {
      kind: "structured_table",
      version: "structured-table/v1",
      title: "T",
      fields: [
        field({ key: "a", label: "Name" }),
        field({
          key: "b",
          label: "Cost",
          type: "decimal",
          scale: 2,
          unit: "GBP",
        }),
      ],
      rows: [
        {
          row_id: "r1",
          cells: [
            { field_key: "a", value: '=HYPERLINK("x"), "quoted"' },
            { field_key: "b", value: "-5.00" },
          ],
        },
        {
          row_id: "r2",
          cells: [
            { field_key: "b", value: null },
            { field_key: "a", value: "@sum" },
          ],
        },
      ],
      notes: [],
    };
    expect(tableCsv(t)).toBe(
      'Name,Cost (GBP)\n"\'=HYPERLINK(""x""), ""quoted"""' + ",-5.00\n'@sum,\n",
    );
  });

  it("drops blank note lines, which the service would refuse", () => {
    expect(notesFrom("a\n\n  b  \n")).toEqual(["a", "b"]);
  });
});

describe("agent-made view actions", () => {
  it("builds the request only from the saved view revision", () => {
    const req = viewActionRequest(
      { id: "rev-1", body_hash: "f".repeat(64) },
      view,
      "refresh",
      "req-1",
    );
    expect(req).toEqual({
      schema_version: "workagent/v1",
      request_id: "req-1",
      view_revision_id: "rev-1",
      view_body_hash: "f".repeat(64),
      access_generation: view.access_generation,
      action: "refresh",
      payload: {},
    });
  });

  it("accepts only an empty plain payload", () => {
    expect(isEmptyPayload({})).toBe(true);
    expect(isEmptyPayload(null)).toBe(true);
    expect(isEmptyPayload({ artifact_id: "other" })).toBe(false);
    expect(isEmptyPayload([])).toBe(false);
    expect(isEmptyPayload("x")).toBe(false);
    expect(isEmptyPayload(Object.create(null))).toBe(false);
  });

  it("says which bindings are current and rebinds only on request", () => {
    const b = view.bindings![0]!;
    const same = {
      [b.artifact_id]: { revision_id: b.revision_id, body_hash: b.body_hash },
    };
    expect(bindingStates(view, same).map((s) => s.state)).toEqual(["current"]);
    const moved = {
      [b.artifact_id]: { revision_id: "newer", body_hash: "a".repeat(64) },
    };
    expect(bindingStates(view, moved).map((s) => s.state)).toEqual(["changed"]);
    expect(bindingStates(view, {}).map((s) => s.state)).toEqual([
      "unavailable",
    ]);
    const next = rebind(view, moved);
    expect(next.bindings![0]).toEqual({
      ...b,
      revision_id: "newer",
      body_hash: "a".repeat(64),
    });
    // Nothing else about the view changes.
    expect({ ...next, bindings: view.bindings }).toEqual(view);
  });
});

describe("row names", () => {
  it("prefer an editable text column over a read-only reference", () => {
    const t = {
      ...venues,
      fields: [
        { key: "ref", label: "Ref", type: "text" as const, editable: false },
        ...venues.fields,
      ],
      rows: venues.rows.map((r, i) => ({
        ...r,
        cells: [{ field_key: "ref", value: `R${i}` }, ...r.cells],
      })),
    };
    expect(rowName(t, t.rows[0]!, 1)).toBe(
      cellValue(venues.rows[0]!, venues.fields[0]!.key),
    );
    const blank = setCell(t, t.rows[0]!.row_id, venues.fields[0]!.key, null);
    expect(rowName(blank, blank.rows[0]!, 1)).toBe("Row 1");
  });
});

describe("draft turns", () => {
  const reply = (kinds: string[]) => [
    { run_id: "r", author_kind: "human" as const, result: null },
    {
      run_id: "r",
      author_kind: "assistant" as const,
      result: {
        results: [
          { kind: "text" },
          ...kinds.map((kind) => ({ kind, artifact_id: "a" })),
        ],
      },
    },
  ];
  it("a reply that delivered a draft is a reply, not a failure", () => {
    expect(
      draftAware("failed", "r", reply(["structured_table"]) as never),
    ).toBe("replied");
    expect(
      draftAware("failed", "r", reply(["custom_view", "document"]) as never),
    ).toBe("replied");
  });
  it("anything else keeps the service's state", () => {
    expect(draftAware("failed", "r", reply([]) as never)).toBe("failed");
    expect(draftAware("failed", "r", reply(["table"]) as never)).toBe("failed");
    expect(draftAware("failed", "other", reply(["document"]) as never)).toBe(
      "failed",
    );
    expect(draftAware("unavailable", "r", reply(["document"]) as never)).toBe(
      "unavailable",
    );
  });
  it("a unit already in the label isn't repeated", () => {
    expect(
      fieldHeading({
        key: "h",
        label: "Hours",
        type: "integer",
        editable: true,
        unit: "hours",
      }),
    ).toBe("Hours");
  });
});
