import { describe, expect, it } from "vitest";
import {
  columnLabel,
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
      tableSummary(body([row("A", "1.00", "1.00", "0.00")])).headline,
    ).toBe("The row matches its reported total.");
    expect(
      tableSummary(
        body([
          row("A", "2.00", "1.00", "1.00"),
          row("B", "3.00", "1.00", "2.00"),
          row("C", "1.00", "1.00", "0.00"),
        ]),
      ).headline,
    ).toBe("2 of 3 rows don’t match their reported totals.");
  });

  it("never invents totals from unreadable values or uncalculated rows", () => {
    const b = body([row("A", "x", "1.00", "0.00")]);
    expect(tableSummary(b).reportedTotal).toBeNull();
    const raw = { ...b, columns: ["id", "reported_total"] };
    expect(tableSummary(raw)).toMatchObject({
      calculated: false,
      calculatedTotal: null,
      headline: "Not calculated yet.",
    });
  });

  it("labels columns plainly and keeps unknown ones readable", () => {
    expect(columnLabel("reported_total")).toBe("Reported");
    expect(columnLabel("customer_ref")).toBe("Customer ref");
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
