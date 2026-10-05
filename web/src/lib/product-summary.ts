import type { components } from "../../../contracts/src/client";

type TableBody = components["schemas"]["TableBody"];
type ToolBody = components["schemas"]["ToolBody"];

/** Plain column names; the raw names stay as accessible labels and in exports. */
const COLUMN_LABEL: Record<string, string> = {
  id: "ID",
  quantity: "Qty",
  unit_price: "Unit price",
  reported_total: "Reported",
  calculated_total: "Calculated",
  difference: "Difference",
  check: "Check",
  note: "Note",
};

export function columnLabel(column: string): string {
  if (COLUMN_LABEL[column]) return COLUMN_LABEL[column];
  const words = column.replace(/[_-]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : column;
}

/** Columns the calculation owns; people edit the raw ones. */
export const DERIVED_COLUMNS = ["calculated_total", "difference", "check"];

export const ROUNDING_LABEL: Record<TableBody["rounding"], string> = {
  ROUND_HALF_UP: "Round halves up",
  ROUND_HALF_EVEN: "Round halves to even",
};

/** Exact two-decimal money arithmetic in integer cents; null when unparseable. */
function cents(value: string | undefined): number | null {
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec((value ?? "").trim());
  if (!m) return null;
  const n = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0") || 0);
  return m[1] ? -n : n;
}
function money(c: number): string {
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(c);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

export interface TableSummary {
  /** Whether the saved rows carry calculated values at all. */
  calculated: boolean;
  rowCount: number;
  mismatches: {
    id: string;
    reported: string;
    calculated: string;
    difference: string;
  }[];
  reportedTotal: string | null;
  calculatedTotal: string | null;
  headline: string;
}

/**
 * What the reconciliation found, read from the saved rows' own calculated
 * columns (never recomputed here, so the page can't disagree with the record).
 */
export function tableSummary(body: TableBody): TableSummary {
  const calculated = body.columns.includes("calculated_total");
  const mismatches = calculated
    ? body.rows
        .filter((r) => r["check"] === "discrepancy")
        .map((r) => ({
          id: r["id"] ?? "",
          reported: r["reported_total"] ?? "",
          calculated: r["calculated_total"] ?? "",
          difference: r["difference"] ?? "",
        }))
    : [];
  const sum = (column: string): string | null => {
    let total = 0;
    for (const r of body.rows) {
      const c = cents(r[column]);
      if (c === null) return null;
      total += c;
    }
    return money(total);
  };
  const reportedTotal = sum("reported_total");
  const calculatedTotal = calculated ? sum("calculated_total") : null;
  const n = body.rows.length;
  let headline: string;
  if (!calculated) headline = "Not calculated yet.";
  else if (!mismatches.length)
    headline =
      n === 1
        ? "The row matches its reported total."
        : `All ${n} rows match their reported totals.`;
  else if (mismatches.length === 1) {
    const m = mismatches[0]!;
    headline = `Row ${m.id} is reported at ${m.reported} but calculates to ${m.calculated}.`;
  } else
    headline = `${mismatches.length} of ${n} rows don’t match their reported totals.`;
  return {
    calculated,
    rowCount: n,
    mismatches,
    reportedTotal,
    calculatedTotal,
    headline,
  };
}

/** The tool's saved inputs as people named them. */
export function toolInputs(body: ToolBody): { label: string; value: string }[] {
  return body.input_form.map((f, i) => ({
    label: f.label,
    value: String(body.arguments[i] ?? ""),
  }));
}
