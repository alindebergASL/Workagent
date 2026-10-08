import { describe, expect, it } from "vitest";
import {
  columnLabel,
  isReconciliation,
  tableColumns,
  tableFilename,
  tableSummary,
  toolInputs,
} from "../src/lib/product-summary";

const columns = [
  "id",
  "quantity",
  "unit_price",
  "reported_total",
  "note",
  "calculated_total",
  "difference",
  "check",
];
const row = (
  id: string,
  reported: string,
  calculated: string,
  difference: string,
) => ({
  id,
  quantity: "1",
  unit_price: calculated,
  reported_total: reported,
  note: "",
  calculated_total: calculated,
  difference,
  check: difference === "0.00" ? "matched" : "discrepancy",
});
const body = (rows: ReturnType<typeof row>[]) => ({
  kind: "table" as const,
  title: "Invoices",
  source_csv: "",
  rounding: "ROUND_HALF_UP" as const,
  columns,
  rows,
  notes: [],
});

describe("table summary leads with what the reconciliation found", () => {
  it("names the single mismatched row with its exact values", () => {
    // The kernel's synthetic fixture: B reported 38.50, calculated 37.50.
    const s = tableSummary(
      body([
        row("A", "39.90", "39.90", "0.00"),
        row("B", "38.50", "37.50", "1.00"),
        row("C", "0.00", "0.00", "0.00"),
      ]),
      true,
    );
    expect(s.headline).toBe(
      "Row B is reported at 38.50 but calculates to 37.50.",
    );
    expect(s.reportedTotal).toBe("78.40");
    expect(s.calculatedTotal).toBe("77.40");
    expect(s.mismatches).toEqual([
      { id: "B", reported: "38.50", calculated: "37.50", difference: "1.00" },
    ]);
  });

  it("says plainly when everything matches, and counts several mismatches", () => {
    expect(
      tableSummary(body([row("A", "1.00", "1.00", "0.00")]), true).headline,
    ).toBe("The row matches its reported total.");
    expect(
      tableSummary(
        body([
          row("A", "2.00", "1.00", "1.00"),
          row("B", "3.00", "1.00", "2.00"),
          row("C", "1.00", "1.00", "0.00"),
        ]),
        true,
      ).headline,
    ).toBe("2 of 3 rows don’t match their reported totals.");
  });

  it("never invents totals from unreadable values or uncalculated rows", () => {
    const b = body([row("A", "x", "1.00", "0.00")]);
    expect(tableSummary(b).reportedTotal).toBeNull();
    const raw = {
      ...b,
      columns: ["id", "quantity", "unit_price", "reported_total"],
    };
    expect(tableSummary(raw)).toMatchObject({
      calculated: false,
      calculatedTotal: null,
      headline: "Not calculated yet.",
    });
    // Without the reconciliation's inputs it is an ordinary table.
    expect(
      tableSummary({ ...b, columns: ["id", "reported_total"] }).headline,
    ).toBe("1 row · 2 columns");
  });

  it("does not present retained calculated columns as checked current results", () => {
    const edited = body([row("A", "2.00", "1.00", "0.00")]);
    expect(tableSummary(edited).headline).toBe(
      "These rows haven’t been checked yet.",
    );
    expect(tableSummary(edited, false).headline).not.toContain("matches");
    expect(
      tableSummary(body([row("A", "1.00", "1.00", "0.00")]), true).headline,
    ).toBe("The row matches its reported total.");
  });

  it("labels columns plainly and keeps unknown ones readable", () => {
    expect(columnLabel("reported_total")).toBe("Reported total");
    expect(columnLabel("customer_ref")).toBe("Customer ref");
    // The reconciliation's own columns keep their short names there only.
    expect(
      tableColumns(body([])).find((c) => c.key === "reported_total")?.label,
    ).toBe("Reported");
  });

  it("pairs tool inputs with their labels", () => {
    expect(
      toolInputs({
        kind: "tool",
        title: "t",
        code: "",
        entrypoint: "total",
        arguments: [3, 1250, 500],
        input_form: [
          {
            name: "q",
            label: "Quantity",
            type: "integer",
            minimum: -1000000000,
            maximum: 1000000000,
          },
          {
            name: "p",
            label: "Unit price cents",
            type: "integer",
            minimum: -1000000000,
            maximum: 1000000000,
          },
          {
            name: "s",
            label: "Shipping cents",
            type: "integer",
            minimum: -1000000000,
            maximum: 1000000000,
          },
        ],
        notes: [],
      }),
    ).toEqual([
      { label: "Quantity", value: "3" },
      { label: "Unit price cents", value: "1250" },
      { label: "Shipping cents", value: "500" },
    ]);
  });
});

describe("tables that aren't reconciliations", () => {
  const schedule = {
    kind: "table" as const,
    title: "Workshop schedule",
    source_csv: "",
    rounding: "ROUND_HALF_UP" as const,
    columns: ["day", "session", "owner", "check"],
    rows: [
      { day: "Mon", session: "Intro", owner: "Ana", check: "done" },
      { day: "Tue", session: "Lab", owner: "Ben", check: "" },
    ],
    notes: [],
  };
  it("is generic: every column editable, readable labels, no reconciliation claims", () => {
    expect(isReconciliation(schedule)).toBe(false);
    expect(tableColumns(schedule)).toEqual([
      { key: "day", label: "Day", derived: false },
      { key: "session", label: "Session", derived: false },
      { key: "owner", label: "Owner", derived: false },
      { key: "check", label: "Check", derived: false },
    ]);
    expect(tableSummary(schedule, true)).toMatchObject({
      calculated: false,
      mismatches: [],
      headline: "2 rows · 4 columns",
    });
    expect(tableFilename(schedule)).toBe("workshop-schedule.csv");
  });
  it("keeps the reconciliation behaviour when its inputs are present", () => {
    const rec = {
      ...schedule,
      columns: [
        "id",
        "quantity",
        "unit_price",
        "reported_total",
        "calculated_total",
        "check",
      ],
      rows: [],
    };
    expect(isReconciliation(rec)).toBe(true);
    expect(
      tableColumns(rec)
        .filter((c) => c.derived)
        .map((c) => c.key),
    ).toEqual(["calculated_total", "check"]);
    expect(tableColumns(rec)[1]!.label).toBe("Qty");
    expect(tableFilename(rec)).toBe("reconciled.csv");
  });
});
