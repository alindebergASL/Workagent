/**
 * B3.2b office export and editable-copy view helpers over the generated
 * workagent/v1 contract (ExportFile.chart_spec, ExportManifest.chart /
 * fidelity / provenance, ImportOfficeDraft, WorkspaceFile.office_provenance).
 * Table inspection mirrors the backend converter's own `tabular` rules so a
 * chart that the exporter would refuse is never offered as valid; the
 * exporter, not this module, computes every chart value.
 */
import type {
  ChartSpec,
  ExportFile,
  ExportFormat,
  ExportManifest,
  FileVersionRef,
  ImportOfficeDraft,
  WorkspaceFile,
  WorkspaceFilePage,
} from "@/lib/files-contract";
import { failedWriteOutcome } from "@/lib/file-draft";

export type { ChartSpec };
export type ChartAggregation = ChartSpec["aggregation"];
export const CHART_AGGREGATIONS: ChartAggregation[] = ["sum", "count", "mean"];

/** MIME the downloaded blob must carry for each requested format. */
export const FORMAT_MIMES: Record<ExportFormat, string> = {
  txt: "text/plain",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  png: "image/png",
};
export const FORMATS = Object.keys(FORMAT_MIMES) as ExportFormat[];

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  txt: "Plain text (.txt)",
  markdown: "Markdown (.md)",
  csv: "CSV (.csv)",
  json: "JSON (.json)",
  docx: "Word document (.docx)",
  xlsx: "Excel workbook (.xlsx)",
  pdf: "PDF (.pdf)",
  png: "Bar chart image (.png)",
};

/** Limits stated before export; the manifest's own `fidelity` wins after. */
export const FORMAT_FIDELITY: Partial<Record<ExportFormat, string>> = {
  docx: "Plain paragraphs (workbooks as cell lines); human annotations and omissions are added as text. No styles, layout or comments.",
  xlsx: "Cell values per sheet plus an “Export notes” sheet; formulas are written without cached results. No formatting.",
  pdf: "Plain paragraphs in one fixed font; annotations and omissions are added as text. No layout fidelity.",
  png: "One bar chart of grouped values computed by the exporter. The image itself omits annotations; the computed rows are listed in the details.",
};

export const OFFICE_DRAFT_MIME = "application/json";
export const OFFICE_SOURCE_MIMES: Record<string, string> = {
  [FORMAT_MIMES.docx]: "Word document",
  [FORMAT_MIMES.xlsx]: "Excel workbook",
  // Text layer only: a page with no text (a scan) is refused, never OCR'd.
  [FORMAT_MIMES.pdf]: "PDF",
};

export const CHART_TEXT_MAX = 200;
const CATEGORY_MAX = 100;
const GROUP_MAX = 50;
// The backend's office_content.DECIMAL.
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]{1,3})?$/;

/* ------------------------------------------------------------------ */
/* Saved table inspection: CSV or a single-sheet office-v1 workbook    */
/* ------------------------------------------------------------------ */

export interface TableColumn {
  name: string;
  /** Every body cell is a decimal string (sum/mean allowed). */
  numeric: boolean;
  /** Every body cell is a non-empty category of ≤100 characters. */
  categorical: boolean;
  /** Distinct category values (capped just past the group limit). */
  distinct: number;
}
export interface SavedTable {
  source: "csv" | "workbook";
  columns: TableColumn[];
  rowCount: number;
}
export type TableResult = { table: SavedTable } | { reason: string };

/** Minimal RFC 4180 CSV reader (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function describe(
  source: SavedTable["source"],
  headers: unknown[],
  body: (string | null)[][],
): TableResult {
  if (
    headers.some(
      (h) => typeof h !== "string" || !h || h.length > CATEGORY_MAX,
    ) ||
    new Set(headers).size !== headers.length
  )
    return {
      reason: "The table’s first row needs unique, non-empty column names.",
    };
  if (body.some((r) => r.length !== headers.length))
    return { reason: "The table has rows of different lengths." };
  const columns = (headers as string[]).map((name, c) => {
    const cells = body.map((r) => r[c] ?? null);
    const values = new Set<string>();
    for (const v of cells) {
      if (values.size > GROUP_MAX) break;
      if (v !== null) values.add(v);
    }
    return {
      name,
      numeric: cells.every((v) => v !== null && DECIMAL.test(v)),
      categorical: cells.every(
        (v) => v !== null && v !== "" && v.length <= CATEGORY_MAX,
      ),
      distinct: values.size,
    };
  });
  return { table: { source, columns, rowCount: body.length } };
}

const COL = /^([A-Z]{1,2})([1-9][0-9]{0,2})$/;
function addressToCell(a: string): [number, number] | null {
  const m = COL.exec(a);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]!) c = c * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]), c];
}

interface WorkbookCell {
  address: string;
  kind: "string" | "number" | "boolean" | "blank" | "formula";
  value: string | boolean | null;
}

/**
 * Reads the column names of a SAVED version the exporter can chart: a CSV,
 * or a typed `office-v1` workbook JSON with exactly one sheet whose row 1 is
 * the header and whose cells are only strings, numbers or blanks.
 */
export function inspectSavedTable(text: string, mime: string): TableResult {
  if (mime === "text/csv") {
    const rows = parseCsv(text);
    if (rows.length < 2 || rows.length > 1001)
      return { reason: "A chart needs a header row and 1–1,000 data rows." };
    if (rows[0]!.length < 1 || rows[0]!.length > 100)
      return { reason: "A chart table has 1–100 columns." };
    return describe("csv", rows[0]!, rows.slice(1));
  }
  if (mime !== OFFICE_DRAFT_MIME)
    return {
      reason: "A chart needs a saved CSV or a single-sheet workbook copy.",
    };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { reason: "This JSON is not a typed office-v1 workbook." };
  }
  const v = value as {
    office_version?: unknown;
    kind?: unknown;
    sheets?: { cells?: WorkbookCell[] }[];
  };
  if (!v || v.office_version !== "office-v1" || v.kind !== "workbook")
    return {
      reason: "A chart needs a saved CSV or a typed office-v1 workbook.",
    };
  if (!Array.isArray(v.sheets) || v.sheets.length !== 1)
    return { reason: "A chart needs a workbook with exactly one sheet." };
  const grid = new Map<string, WorkbookCell>();
  let height = 0;
  let width = 0;
  for (const cell of v.sheets[0]!.cells ?? []) {
    const rc = cell && addressToCell(cell.address);
    if (!rc) return { reason: "The workbook has an invalid cell address." };
    grid.set(`${rc[0]}:${rc[1]}`, cell);
    height = Math.max(height, rc[0]);
    width = Math.max(width, rc[1]);
  }
  if (height < 2 || height > 1000 || width < 1 || width > 100)
    return {
      reason:
        "A chart needs a header row and 1–999 data rows in 1–100 columns.",
    };
  const at = (r: number, c: number): string | null | false => {
    const cell = grid.get(`${r}:${c}`);
    if (!cell || cell.kind === "blank") return null;
    if (cell.kind === "formula" || cell.kind === "boolean") return false;
    return typeof cell.value === "string" ? cell.value : null;
  };
  const read = (r: number) => {
    const out: (string | null)[] = [];
    for (let c = 1; c <= width; c++) {
      const x = at(r, c);
      if (x === false) return null;
      out.push(x);
    }
    return out;
  };
  const rows: (string | null)[][] = [];
  for (let r = 1; r <= height; r++) {
    const row = read(r);
    if (!row)
      return {
        reason:
          "Charts use plain values only; this sheet has formula or true/false cells.",
      };
    rows.push(row);
  }
  return describe("workbook", rows[0]!, rows.slice(1));
}

/* ------------------------------------------------------------------ */
/* Validation and exact request/readback                               */
/* ------------------------------------------------------------------ */

export function defaultChartSpec(table: SavedTable): ChartSpec {
  const category =
    table.columns.find((c) => c.categorical && !c.numeric) ??
    table.columns.find((c) => c.categorical) ??
    table.columns[0]!;
  const value = table.columns.find(
    (c) => c.numeric && c.name !== category.name,
  );
  return {
    category_column: category.name,
    value_column: value ? value.name : null,
    aggregation: value ? "sum" : "count",
    title: "",
    x_label: category.name,
    y_label: value ? value.name : "Count",
  };
}

const hasControl = (t: string) =>
  [...t].some((ch) => ch.charCodeAt(0) < 32 && !"\t\n\r".includes(ch));

export function chartProblem(
  spec: ChartSpec,
  table: SavedTable,
): string | null {
  const col = (n: string | null | undefined) =>
    table.columns.find((c) => c.name === n);
  const cat = col(spec.category_column);
  if (!cat) return "Choose a category column from the saved table.";
  if (!cat.categorical)
    return `Every row needs a “${cat.name}” value (1–100 characters) to group by.`;
  if (cat.distinct > GROUP_MAX)
    return `“${cat.name}” has more than ${GROUP_MAX} distinct values; the chart allows ${GROUP_MAX} bars.`;
  if (!CHART_AGGREGATIONS.includes(spec.aggregation))
    return "Choose sum, count or mean.";
  if (spec.aggregation === "count") {
    if (spec.value_column != null)
      return "Count uses rows per category; clear the value column.";
  } else {
    const v = col(spec.value_column);
    if (!v) return `Choose a value column to ${spec.aggregation}.`;
    if (v.name === spec.category_column)
      return "The value column must differ from the category column.";
    if (!v.numeric)
      return `“${v.name}” has empty or non-numeric cells and cannot be ${spec.aggregation === "sum" ? "summed" : "averaged"}.`;
  }
  if (!spec.title.trim()) return "Give the chart a title.";
  for (const [label, t] of [
    ["title", spec.title],
    ["x-axis label", spec.x_label],
    ["y-axis label", spec.y_label],
  ] as const) {
    if (t.length > CHART_TEXT_MAX)
      return `The ${label} is limited to ${CHART_TEXT_MAX} characters.`;
    if (hasControl(t)) return `The ${label} contains control characters.`;
  }
  return null;
}

/** Why this format can't be requested for this saved version, or null. */
export function exportProblem(
  format: ExportFormat,
  table: TableResult | null,
  chart: ChartSpec | null,
): string | null {
  if (!FORMATS.includes(format)) return "Unknown export format.";
  if (format !== "png") return null;
  if (!table) return "Waiting for the saved version to load.";
  if ("reason" in table) return table.reason;
  if (!chart) return "Choose the chart settings.";
  return chartProblem(chart, table.table);
}

/**
 * The exact body for one export of one SAVED version. `chart_spec` is sent
 * only for png (the exporter rejects it otherwise), with `value_column`
 * always present, so non-chart bodies keep the original shape.
 */
export function buildExportBody(
  env: Pick<ExportFile, "schema_version" | "request_id" | "command_id">,
  ref: FileVersionRef,
  format: ExportFormat,
  chart: ChartSpec | null,
): ExportFile {
  const body: ExportFile = {
    ...env,
    version_id: ref.version_id,
    sha256: ref.sha256,
    format,
  };
  if (format === "png" && chart)
    body.chart_spec = {
      category_column: chart.category_column,
      value_column: chart.value_column ?? null,
      aggregation: chart.aggregation,
      title: chart.title,
      x_label: chart.x_label,
      y_label: chart.y_label,
    };
  return body;
}

function sameChart(a: ChartSpec, b: ChartSpec): boolean {
  return (
    a.category_column === b.category_column &&
    (a.value_column ?? null) === (b.value_column ?? null) &&
    a.aggregation === b.aggregation &&
    a.title === b.title &&
    a.x_label === b.x_label &&
    a.y_label === b.y_label
  );
}

/**
 * The manifest must describe exactly what was asked for: this file, this
 * saved version and hash, this format and MIME, and (for a chart) the same
 * spec with the exporter's computed rows. Returns what differed, or null.
 */
export function manifestReadbackProblem(
  body: ExportFile,
  fileId: string,
  m: ExportManifest,
): string | null {
  if (m.workspace_file_id !== fileId)
    return "The export answered for a different file.";
  if (m.revision_id !== body.version_id || m.input_sha256 !== body.sha256)
    return "The export was made from a different saved version than requested.";
  if (m.format !== body.format)
    return `Requested ${body.format} but the export is ${m.format}.`;
  if (m.blob.mime_type !== FORMAT_MIMES[body.format])
    return `The export’s type (${m.blob.mime_type}) is not ${FORMAT_MIMES[body.format]}.`;
  if (body.chart_spec) {
    if (!m.chart) return "The exporter did not report the chart it computed.";
    if (!sameChart(body.chart_spec, m.chart.spec))
      return "The exporter used different chart settings than requested.";
    // The supported chart inputs (saved CSV / typed office-v1 workbook) are
    // converted as the exact saved bytes, so the chart must name that hash.
    if (m.chart.input_sha256 !== body.sha256)
      return "The chart was computed from different input than the saved version.";
    if (m.chart.rows.length === 0)
      return "The exporter reported no computed chart rows.";
  } else if (m.chart) return "The exporter attached a chart nobody requested.";
  return null;
}

/* ------------------------------------------------------------------ */
/* Durable journal compatibility                                       */
/* ------------------------------------------------------------------ */

const isStr = (v: unknown): v is string => typeof v === "string";

function isEnvelope(b: Record<string, unknown>): boolean {
  return (
    b.schema_version === "workagent/v1" &&
    isStr(b.request_id) &&
    isStr(b.command_id)
  );
}

function isChartSpec(v: unknown): v is ChartSpec {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    isStr(c.category_column) &&
    (c.value_column === null || isStr(c.value_column)) &&
    CHART_AGGREGATIONS.includes(c.aggregation as ChartAggregation) &&
    isStr(c.title) &&
    isStr(c.x_label) &&
    isStr(c.y_label)
  );
}

/**
 * Whether a journaled export (possibly written before chart support, with no
 * `chart_spec` at all) can be replayed byte-for-byte. A stored entry that
 * fails this is never retried blindly: the UI offers only to discard it.
 */
export function isReplayableExport(v: unknown): v is ExportFile {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  if (
    !isEnvelope(b) ||
    !isStr(b.version_id) ||
    !isStr(b.sha256) ||
    !FORMATS.includes(b.format as ExportFormat)
  )
    return false;
  if (b.format === "png") return isChartSpec(b.chart_spec);
  return b.chart_spec === undefined;
}

/* ------------------------------------------------------------------ */
/* One journaled command attempt (export or editable copy)             */
/* ------------------------------------------------------------------ */

/** The slice of usePendingCommand this flow relies on. */
export interface Journal<T> {
  readonly current: T | null;
  set(value: T | null): void;
  clear(expected: T): boolean;
  readonly restored: boolean;
}

export type JournaledOutcome<T, R> =
  | { kind: "done"; body: T; result: R }
  /**
   * The service answered, but not for what was asked; nothing is offered and
   * the command stays journaled (unresolved), so it is never re-issued fresh.
   */
  | { kind: "mismatch"; body: T; message: string }
  | { kind: "failed"; error: unknown; unknownOutcome: boolean }
  /** A stored entry this build can't replay exactly; it was not sent. */
  | { kind: "unreadable" }
  | { kind: "invalid" }
  /** A reply for a mount or journal entry that no longer owns the command. */
  | { kind: "stale" };

/**
 * Sends the journaled command if one is held (exact stored bytes, never
 * rebuilt from the current controls), otherwise journals a freshly built
 * body BEFORE sending it. Same resolution rules as file create/save.
 */
export async function runJournaled<T, R>(
  journal: Journal<T>,
  opts: {
    everUnknown: boolean;
    isReplayable: (v: unknown) => v is T;
    build: () => T | null;
    send: (body: T) => Promise<R>;
    readback: (body: T, result: R) => string | null;
    isAmbiguous: (e: unknown) => boolean;
    alive?: () => boolean;
  },
): Promise<JournaledOutcome<T, R>> {
  const alive = opts.alive ?? (() => true);
  const held = journal.current;
  if (held !== null && !opts.isReplayable(held)) return { kind: "unreadable" };
  let body = held;
  if (body === null) {
    body = opts.build();
    if (body === null) return { kind: "invalid" };
    journal.set(body);
  }
  try {
    const result = await opts.send(body);
    if (!alive()) return { kind: "stale" };
    // Exact readback BEFORE resolving: a refused answer keeps the journal.
    const problem = opts.readback(body, result);
    if (problem) return { kind: "mismatch", body, message: problem };
    if (!journal.clear(body)) return { kind: "stale" };
    return { kind: "done", body, result };
  } catch (error) {
    if (!alive()) return { kind: "stale" };
    const after = failedWriteOutcome(
      opts.isAmbiguous(error),
      opts.everUnknown || journal.restored,
    );
    if (!after.keepPending) journal.clear(body);
    return { kind: "failed", error, unknownOutcome: after.unknownOutcome };
  }
}

/* ------------------------------------------------------------------ */
/* Editable copy (office-v1 draft) of an immutable DOCX/XLSX source    */
/* ------------------------------------------------------------------ */

export const isImageMime = (mime: string) => mime.startsWith("image/");

/** Only an immutable DOCX/XLSX/PDF source snapshot offers "Create editable copy". */
export function canOfferEditableCopy(f: WorkspaceFile): boolean {
  return (
    !f.editable &&
    f.storage === "source_snapshot" &&
    f.mime_type in OFFICE_SOURCE_MIMES
  );
}

export function isReplayableEditableCopy(v: unknown): v is ImportOfficeDraft {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  const s = b.source as Record<string, unknown> | null | undefined;
  return (
    isEnvelope(b) &&
    typeof b.expected_work_version === "number" &&
    !!s &&
    isStr(s.workspace_file_id) &&
    isStr(s.version_id) &&
    isStr(s.sha256)
  );
}

/**
 * The import must return a NEW editable office-v1 JSON working file in the
 * same workspace and conversation, bound to exactly the requested source
 * snapshot: for a source-snapshot file the version id IS the snapshot id and
 * the version sha256 IS the extraction sha256.
 */
export function editableCopyReadbackProblem(
  body: ImportOfficeDraft,
  f: WorkspaceFile,
  scope: { workspaceId: string; conversationId: string },
): string | null {
  if (
    f.workspace_id !== scope.workspaceId ||
    f.conversation_id !== scope.conversationId
  )
    return "The copy belongs to a different workspace or conversation.";
  if (f.workspace_file_id === body.source.workspace_file_id)
    return "The service answered with the original source, not a new copy.";
  if (!f.editable || f.storage !== "artifact_revision")
    return "The service did not return an editable working copy.";
  if (f.mime_type !== OFFICE_DRAFT_MIME)
    return `Expected an office-v1 JSON copy but received ${f.mime_type}.`;
  const p = f.office_provenance;
  if (!p || p.transformation_version !== "office-v1")
    return "The copy does not record which original it was made from.";
  if (
    p.source_snapshot_id !== body.source.version_id ||
    p.extraction_sha256 !== body.source.sha256
  )
    return "The copy was made from a different source snapshot than requested.";
  return null;
}

/**
 * A just-created file may be opened only when a fresh list read contains
 * exactly it: same id, workspace, conversation and current version/hash.
 */
export function openTargetProblem(
  page: WorkspaceFilePage,
  target: WorkspaceFile,
): string | null {
  const f = page.items.find(
    (x) => x.workspace_file_id === target.workspace_file_id,
  );
  if (!f)
    return "The new copy is not in the file list yet; nothing was opened.";
  if (
    f.workspace_id !== target.workspace_id ||
    f.conversation_id !== target.conversation_id ||
    f.current.version_id !== target.current.version_id ||
    f.current.sha256 !== target.current.sha256
  )
    return "The file list shows a different version of the new copy; nothing was opened.";
  return null;
}
