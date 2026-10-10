import type { components } from "../../../contracts/src/client";

/**
 * Self-describing work (issue #13): documents, structured tables and
 * agent-made views. Everything here is driven by what the saved body
 * declares about itself; nothing depends on what the work is about.
 */
type S = components["schemas"];
export type DocumentBody = S["Body"];
export type StructuredTable = S["StructuredTableBody-Output"];
export type TableField = S["TableField"];
export type CellValue = S["TableCell"]["value"];
export type CustomView = S["CustomViewBody-Output"];
export type FlexibleBody = DocumentBody | StructuredTable | CustomView;
export type FlexibleKind = "document" | "structured_table" | "custom_view";

type AnyBody = S["Revision"]["body"] | S["Proposal"]["body"];

/** Which self-describing shape a saved body is, or null for older kinds. */
export function flexibleKind(body: AnyBody): FlexibleKind | null {
  if ("kind" in body) {
    if (body.kind === "structured_table" || body.kind === "custom_view")
      return body.kind;
    return null;
  }
  return "blocks" in body ? "document" : null;
}
export function isFlexible(body: AnyBody): body is FlexibleBody {
  return flexibleKind(body) !== null;
}

export const KIND_LABEL: Record<FlexibleKind, string> = {
  document: "Document",
  structured_table: "Table",
  custom_view: "Interactive view",
};

/** A field's column heading: its own label, plus its unit when it has one. */
export function fieldHeading(field: TableField): string {
  const unit = field.unit?.trim();
  return unit && !field.label.toLowerCase().includes(unit.toLowerCase())
    ? `${field.label} (${unit})`
    : field.label;
}

export function cellValue(
  row: S["TableRow"],
  key: string,
): CellValue | undefined {
  return row.cells.find((c) => c.field_key === key)?.value;
}

/** How a saved cell reads. Missing values read as a dash, never as zero. */
export function formatCell(field: TableField, value: CellValue | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/** The text an input shows for a saved cell. */
export function cellInput(value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

const MAX_SAFE = 9007199254740991;

/**
 * Read what a person typed into a cell, by the field's declared type and the
 * same bounds the service enforces. Empty means no value.
 */
export function parseCell(
  field: TableField,
  raw: string,
): { value: CellValue } | { error: string } {
  const text = field.type === "text" ? raw : raw.trim();
  if (!text.trim()) return { value: null };
  switch (field.type) {
    case "text":
      return text.length > 2000
        ? { error: "Keep this to 2,000 characters." }
        : { value: text };
    case "integer": {
      if (!/^-?\d+$/.test(text)) return { error: "Use a whole number." };
      const n = Number(text);
      return Math.abs(n) > MAX_SAFE
        ? { error: "That number is too large." }
        : { value: n };
    }
    case "decimal": {
      const scale = field.scale ?? 0;
      const m = /^(-)?(\d+)(?:\.(\d*))?$/.exec(text);
      const digits = m?.[2]?.replace(/^0+(?=\d)/, "");
      const fraction = m?.[3] ?? "";
      if (!m || !digits || digits.length > 15 || fraction.length > scale)
        return {
          error: scale
            ? `Use a number with up to ${scale} decimal place${scale === 1 ? "" : "s"}.`
            : "Use a whole number.",
        };
      const padded = scale
        ? `${digits}.${fraction.padEnd(scale, "0")}`
        : digits;
      const zero = /^0(\.0*)?$/.test(padded);
      return { value: `${m[1] && !zero ? "-" : ""}${padded}` };
    }
    case "boolean":
      if (/^(yes|true)$/i.test(text)) return { value: true };
      if (/^(no|false)$/i.test(text)) return { value: false };
      return { error: "Choose yes or no." };
    case "enum":
      return (field.enum ?? []).includes(text)
        ? { value: text }
        : { error: "Choose one of the listed options." };
  }
}

export function setCell(
  body: StructuredTable,
  rowId: string,
  key: string,
  value: CellValue,
): StructuredTable {
  return {
    ...body,
    rows: body.rows.map((r) =>
      r.row_id === rowId
        ? {
            ...r,
            cells: r.cells.map((c) =>
              c.field_key === key ? { ...c, value } : c,
            ),
          }
        : r,
    ),
  };
}

/** A new empty row with its own stable identity. */
export function addRow(body: StructuredTable, id: string): StructuredTable {
  return {
    ...body,
    rows: [
      ...body.rows,
      {
        row_id: id,
        cells: body.fields.map((f) => ({ field_key: f.key, value: null })),
      },
    ],
  };
}

/**
 * Whether a person may remove this row: a row the saved version doesn't have
 * yet always; a saved row only when none of its fields are read-only.
 */
export function canRemoveRow(
  saved: StructuredTable,
  body: StructuredTable,
  rowId: string,
): boolean {
  if (!saved.rows.some((r) => r.row_id === rowId)) return true;
  return body.fields.every((f) => f.editable);
}

export function removeRow(
  body: StructuredTable,
  rowId: string,
): StructuredTable {
  return { ...body, rows: body.rows.filter((r) => r.row_id !== rowId) };
}

/**
 * A short name for a row, from its first editable text value (people name
 * things in columns they can edit; read-only text is usually a reference).
 */
export function rowName(body: StructuredTable, row: S["TableRow"], n: number) {
  const first =
    body.fields.find((f) => f.type === "text" && f.editable) ??
    body.fields.find((f) => f.type === "text");
  const v = first ? cellValue(row, first.key) : null;
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : `Row ${n}`;
}

/** What changed between two versions of a table, in plain counts. */
export function tableChanges(before: StructuredTable, after: StructuredTable) {
  const old = new Map(before.rows.map((r) => [r.row_id, r]));
  const now = new Set(after.rows.map((r) => r.row_id));
  let added = 0;
  let cells = 0;
  for (const r of after.rows) {
    const o = old.get(r.row_id);
    if (!o) {
      added++;
      continue;
    }
    for (const c of r.cells) if (cellValue(o, c.field_key) !== c.value) cells++;
  }
  const removed = before.rows.filter((r) => !now.has(r.row_id)).length;
  const keys = new Set(before.fields.map((f) => f.key));
  const fields = after.fields.filter((f) => !keys.has(f.key)).length;
  return { added, removed, cells, fields };
}

export function changeSummary(c: ReturnType<typeof tableChanges>): string {
  const parts = [
    c.cells ? `${c.cells} value${c.cells === 1 ? "" : "s"} changed` : "",
    c.added ? `${c.added} row${c.added === 1 ? "" : "s"} added` : "",
    c.removed ? `${c.removed} row${c.removed === 1 ? "" : "s"} removed` : "",
    c.fields ? `${c.fields} new column${c.fields === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No changes to the values";
}

/**
 * The saved table as CSV, made in the browser from the saved version. A
 * cell that a spreadsheet would treat as a formula is quoted as text.
 */
export function tableCsv(body: StructuredTable): string {
  const esc = (s: string) => {
    const safe =
      /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = body.fields.map((f) => esc(fieldHeading(f)));
  const rows = body.rows.map((r) =>
    body.fields.map((f) => {
      const v = cellValue(r, f.key);
      return esc(v === null || v === undefined ? "" : String(v));
    }),
  );
  return [head, ...rows].map((r) => r.join(",")).join("\n") + "\n";
}

export function slug(title: string, fallback: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || fallback
  );
}

/** Notes as people edit them: one per line, blank lines dropped. */
export function notesFrom(text: string): string[] {
  return text
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 10);
}

/**
 * The one request the trusted shell sends for a view's declared action. The
 * view supplies only the action name; everything that decides what is read
 * comes from the saved view revision on screen.
 */
export function viewActionRequest(
  revision: { id: string; body_hash: string },
  view: CustomView,
  action: string,
  requestId: string,
): S["ViewActionRequest"] {
  return {
    schema_version: "workagent/v1",
    request_id: requestId,
    view_revision_id: revision.id,
    view_body_hash: revision.body_hash,
    access_generation: view.access_generation,
    action,
    payload: {},
  };
}

/** A view's action payload must be exactly an empty plain object. */
export function isEmptyPayload(payload: unknown): boolean {
  return (
    payload === null ||
    (typeof payload === "object" &&
      !Array.isArray(payload) &&
      Object.getPrototypeOf(payload) === Object.prototype &&
      Reflect.ownKeys(payload).length === 0)
  );
}

/** Each binding of a view, and whether it still reads the current version. */
export function bindingStates(
  view: CustomView,
  current: Record<string, { revision_id: string; body_hash: string } | null>,
) {
  return (view.bindings ?? []).map((b) => {
    const now = current[b.artifact_id];
    return {
      binding: b,
      state: !now
        ? ("unavailable" as const)
        : now.revision_id === b.revision_id && now.body_hash === b.body_hash
          ? ("current" as const)
          : ("changed" as const),
    };
  });
}

/**
 * Whether the view's own code names the exact versions it was made for. Such
 * a view checks what it reads against them, so pointing it at a newer version
 * would only make it refuse its own data: it needs regenerating instead.
 */
export function pinsVersions(view: CustomView): boolean {
  const code = [view.source.html, view.source.css, view.source.js].join("\n");
  return (view.bindings ?? []).some(
    (b) => code.includes(b.revision_id) || code.includes(b.body_hash),
  );
}

/** The same view, pointed at the current saved versions of what it reads. */
export function rebind(
  view: CustomView,
  current: Record<string, { revision_id: string; body_hash: string } | null>,
): CustomView {
  return {
    ...view,
    bindings: (view.bindings ?? []).map((b) => {
      const now = current[b.artifact_id];
      return now
        ? { ...b, revision_id: now.revision_id, body_hash: now.body_hash }
        : b;
    }),
  };
}
