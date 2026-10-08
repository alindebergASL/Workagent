import type { components } from "../../../contracts/src/client";

type TableBody = components["schemas"]["TableBody"];
type ToolBody = components["schemas"]["ToolBody"];

/**
 * The reconciliation operation's own columns: what it needs as input, what
 * it writes, and short names for them. Only a table that has those inputs is
 * treated as a reconciliation; any other table renders and edits generically.
 */
const RECONCILE_INPUTS = ["id", "quantity", "unit_price", "reported_total"];
const RECONCILE_LABEL: Record<string, string> = {
  id: "ID",
  quantity: "Qty",
  unit_price: "Unit price",
  reported_total: "Reported",
  calculated_total: "Calculated",
  difference: "Difference",
  check: "Check",
  note: "Note",
};

/** Columns the reconciliation calculation owns; people edit the raw ones. */
const RECONCILE_DERIVED = ["calculated_total", "difference", "check"];

/** Whether the reconciliation operation can recalculate this table. */
export function isReconciliation(body: TableBody): boolean {
  return RECONCILE_INPUTS.every((c) => body.columns.includes(c));
}

/** A readable name for any column key; the raw key stays in exports. */
export function columnLabel(column: string): string {
  if (column.toLowerCase() === "id") return "ID";
  const words = column.replace(/[_-]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : column;
}

export interface ColumnView {
  key: string;
  label: string;
  /** Written by an operation; read-only here and stale once edited. */
  derived: boolean;
}

/**
 * How each column of this table is shown and edited. Every column of an
 * ordinary table is editable; only a reconciliation table locks the columns
 * its calculation writes.
 */
export function tableColumns(body: TableBody): ColumnView[] {
  const reconciles = isReconciliation(body);
  return body.columns.map((key) => ({
    key,
    label: (reconciles && RECONCILE_LABEL[key]) || columnLabel(key),
    derived: reconciles && RECONCILE_DERIVED.includes(key),
  }));
}

/** A download name for a table: the reconciliation's own, else its title. */
export function tableFilename(body: TableBody): string {
  if (isReconciliation(body)) return "reconciled.csv";
  const slug = body.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "table"}.csv`;
}

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
 * Calculated columns alone are not evidence: human edits retain old columns.
 * Only callers with an observation bound to this body may claim checked results.
 */
export function tableSummary(body: TableBody, verified = false): TableSummary {
  const n0 = body.rows.length;
  if (!isReconciliation(body))
    return {
      calculated: false,
      rowCount: n0,
      mismatches: [],
      reportedTotal: null,
      calculatedTotal: null,
      headline: `${n0} row${n0 === 1 ? "" : "s"} · ${body.columns.length} column${body.columns.length === 1 ? "" : "s"}`,
    };
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
  else if (!verified) headline = "These rows haven’t been checked yet.";
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
