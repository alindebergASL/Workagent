import { describe, expect, it } from "vitest";
import {
  buildExportBody,
  canOfferEditableCopy,
  chartProblem,
  defaultChartSpec,
  exportProblem,
  inspectSavedTable,
  isReplayableEditableCopy,
  isReplayableExport,
  parseCsv,
  type ChartSpec,
  type SavedTable,
} from "@/lib/office-export";
import type { WorkspaceFile } from "@/lib/files-contract";

const env = {
  schema_version: "workagent/v1" as const,
  request_id: "r1",
  command_id: "c1",
};
const ref = { workspace_file_id: "f", version_id: "v1", sha256: "h1" };

function tableOf(text: string, mime = "text/csv"): SavedTable {
  const r = inspectSavedTable(text, mime);
  if (!("table" in r)) throw new Error(r.reason);
  return r.table;
}
const reasonOf = (text: string, mime: string) => {
  const r = inspectSavedTable(text, mime);
  return "reason" in r ? r.reason : null;
};

describe("saved table inspection mirrors the exporter's tabular rules", () => {
  it("reads quoted CSV cells, CRLF and doubled quotes", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });

  it("numeric means every body cell is a decimal string; empty cells disqualify", () => {
    const t = tableOf("k,n,m,e\na,1,x,1\nb,2.5e3,3,\n");
    expect(t.columns.map((c) => [c.name, c.numeric, c.categorical])).toEqual([
      ["k", false, true],
      ["n", true, true],
      ["m", false, true],
      ["e", false, false],
    ]);
    expect(tableOf("k\n 1\n").columns[0]!.numeric).toBe(false);
  });

  it("CSV shape limits", () => {
    expect(reasonOf("a,b\n", "text/csv")).toMatch(/header row/);
    expect(reasonOf("a,b\n1\n", "text/csv")).toMatch(/different lengths/);
    expect(reasonOf("a,a\n1,2\n", "text/csv")).toMatch(/unique/);
    expect(reasonOf(",b\n1,2\n", "text/csv")).toMatch(/unique, non-empty/);
  });

  it("JSON must be a single-sheet office-v1 workbook of plain values", () => {
    const wb = (cells: object[], extra: object = {}) =>
      JSON.stringify({
        office_version: "office-v1",
        kind: "workbook",
        sheets: [{ name: "S", cells }],
        annotations: [],
        ...extra,
      });
    const c = (address: string, kind: string, value: unknown) => ({
      address,
      kind,
      value,
      cached_value: null,
    });
    const t = tableOf(
      wb([
        c("A1", "string", "city"),
        c("B1", "string", "n"),
        c("A2", "string", "X"),
        c("B2", "number", "4"),
        c("A3", "string", "Y"),
        c("B3", "number", "-1.5"),
      ]),
      "application/json",
    );
    expect(t.source).toBe("workbook");
    expect(t.rowCount).toBe(2);
    expect(t.columns.map((x) => x.numeric)).toEqual([false, true]);
    // A gap in the grid is a blank cell, which rejects that column for sum.
    expect(
      tableOf(
        wb([
          c("A1", "string", "k"),
          c("B1", "string", "n"),
          c("A2", "string", "x"),
          c("A3", "string", "y"),
          c("B3", "number", "1"),
        ]),
        "application/json",
      ).columns[1]!.numeric,
    ).toBe(false);
    expect(reasonOf(JSON.stringify([{ a: 1 }]), "application/json")).toMatch(
      /typed office-v1/,
    );
    expect(
      reasonOf(
        JSON.stringify({
          office_version: "office-v1",
          kind: "document",
          paragraphs: [],
          annotations: [],
        }),
        "application/json",
      ),
    ).toMatch(/typed office-v1 workbook/);
    expect(
      reasonOf(
        wb([c("A1", "string", "k"), c("A2", "boolean", true)]),
        "application/json",
      ),
    ).toMatch(/true\/false/);
    expect(
      reasonOf(
        JSON.stringify({
          office_version: "office-v1",
          kind: "workbook",
          sheets: [
            { name: "a", cells: [] },
            { name: "b", cells: [] },
          ],
          annotations: [],
        }),
        "application/json",
      ),
    ).toMatch(/exactly one sheet/);
    expect(reasonOf("words", "text/plain")).toMatch(/saved CSV/);
  });
});

describe("chart and export validation", () => {
  const table = tableOf("k,n\na,1\nb,2\n");
  const ok: ChartSpec = { ...defaultChartSpec(table), title: "T" };

  it("defaults to a categorical non-numeric category and a numeric sum", () => {
    expect(defaultChartSpec(table)).toMatchObject({
      category_column: "k",
      value_column: "n",
      aggregation: "sum",
    });
  });

  it.each<[string, Partial<ChartSpec>, RegExp | null]>([
    ["valid", {}, null],
    ["unknown category", { category_column: "zz" }, /category column/],
    ["sum without value", { value_column: null }, /value column to sum/],
    [
      "mean of text",
      { aggregation: "mean", value_column: "k", category_column: "n" },
      /cannot be averaged/,
    ],
    ["count with value", { aggregation: "count" }, /clear the value column/],
    ["count ok", { aggregation: "count", value_column: null }, null],
    ["no title", { title: " " }, /title/],
    ["long label", { x_label: "x".repeat(201) }, /x-axis label/],
    ["control char", { y_label: "a\u0001" }, /control characters/],
  ])("%s", (_n, patch, msg) => {
    const p = chartProblem({ ...ok, ...patch }, table);
    if (msg) expect(p).toMatch(msg);
    else expect(p).toBeNull();
  });

  it("more than 50 categories is refused before sending", () => {
    const rows = Array.from({ length: 51 }, (_, i) => `c${i},1`).join("\n");
    const t = tableOf(`k,n\n${rows}\n`);
    expect(chartProblem({ ...defaultChartSpec(t), title: "T" }, t)).toMatch(
      /more than 50/,
    );
  });

  it("only png depends on a table", () => {
    const none = inspectSavedTable("words", "text/plain");
    for (const f of [
      "txt",
      "markdown",
      "csv",
      "json",
      "docx",
      "xlsx",
      "pdf",
    ] as const)
      expect(exportProblem(f, none, null)).toBeNull();
    expect(exportProblem("png", none, ok)).toMatch(/saved CSV/);
    expect(exportProblem("png", { table }, ok)).toBeNull();
  });

  it("only png bodies carry chart_spec (value_column always present); others keep the legacy shape", () => {
    expect(buildExportBody(env, ref, "docx", ok)).toEqual({
      ...env,
      version_id: "v1",
      sha256: "h1",
      format: "docx",
    });
    const count = buildExportBody(env, ref, "png", {
      ...ok,
      aggregation: "count",
      value_column: undefined,
    });
    expect(count.chart_spec).toHaveProperty("value_column", null);
    const png = buildExportBody(env, ref, "png", ok);
    expect(png.chart_spec).toEqual(ok);
    expect(png.chart_spec).not.toBe(ok);
    expect(isReplayableExport(png)).toBe(true);
    expect(isReplayableExport(buildExportBody(env, ref, "txt", ok))).toBe(true);
    expect(isReplayableExport({ ...png, schema_version: "v0" })).toBe(false);
    // An entry from the pre-contract build (`chart`, not `chart_spec`) is not replayed.
    expect(
      isReplayableExport({
        ...env,
        version_id: "v",
        sha256: "h",
        format: "png",
        chart: ok,
      }),
    ).toBe(false);
  });
});

describe("editable copy eligibility", () => {
  const base = {
    workspace_file_id: "s",
    workspace_id: "w",
    conversation_id: "c",
    filename: "x",
    byte_length: 1,
    current: ref,
    editable: false,
    storage: "source_snapshot",
  } as const;
  it("offers only immutable DOCX/XLSX/PDF source snapshots", () => {
    const f = (mime_type: string, over: Partial<WorkspaceFile> = {}) =>
      canOfferEditableCopy({ ...base, mime_type, ...over } as WorkspaceFile);
    expect(
      f(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
    expect(
      f("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe(true);
    expect(f("application/pdf")).toBe(true);
    expect(
      f("application/pdf", { editable: true, storage: "artifact_revision" }),
    ).toBe(false);
    expect(f("image/png")).toBe(false);
    expect(
      f(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        { editable: true, storage: "artifact_revision" },
      ),
    ).toBe(false);
  });
  it("replay guard needs envelope, work version and exact source ref", () => {
    const body = { ...env, expected_work_version: 1, source: ref };
    expect(isReplayableEditableCopy(body)).toBe(true);
    expect(
      isReplayableEditableCopy({ ...body, source: { version_id: "v" } }),
    ).toBe(false);
    expect(
      isReplayableEditableCopy({ ...body, expected_work_version: "1" }),
    ).toBe(false);
  });
});
