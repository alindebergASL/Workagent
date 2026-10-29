"use client";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { newCommandId } from "@/lib/client/api";
import { ApiError, describeError } from "@/lib/contract/errors";
import { usePendingCommand } from "@/lib/client/pending-command";
import { failedWriteOutcome } from "@/lib/file-draft";
import {
  downloadVerifiedExport,
  envelope,
  importOfficeDraft,
  requestExport,
} from "@/lib/client/workspace-files";
import type {
  ExportFile,
  ExportFormat,
  ExportManifest,
  FileVersionRef,
  ImportOfficeDraft,
  WorkspaceFile,
} from "@/lib/files-contract";
import {
  buildExportBody,
  canOfferEditableCopy,
  CHART_AGGREGATIONS,
  defaultChartSpec,
  editableCopyReadbackProblem,
  exportProblem,
  FORMAT_FIDELITY,
  FORMAT_LABELS,
  FORMATS,
  inspectSavedTable,
  isImageMime,
  isReplayableEditableCopy,
  isReplayableExport,
  manifestReadbackProblem,
  OFFICE_SOURCE_MIMES,
  runJournaled,
  type ChartAggregation,
  type ChartSpec,
} from "@/lib/office-export";

function errText(e: unknown): string {
  // A locally raised integrity refusal (status 0) is already plain language.
  if (e instanceof ApiError && e.status === 0 && e.code === "validation_error")
    return e.message;
  const d = describeError(e);
  return `${d.title}. ${d.nextAction}`;
}
const isAmbiguousWrite = (e: unknown): boolean =>
  e instanceof ApiError && e.isAmbiguousWrite;

function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

/**
 * Long unbroken IDs, SHA-256 digests and office MIME types must wrap inside a
 * 320px viewport instead of widening the page: every details container is
 * allowed to shrink (min-width 0) and breaks anywhere when it must.
 */
export const WRAP: React.CSSProperties = {
  minWidth: 0,
  maxWidth: "100%",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};

/**
 * `.stack-sm` is a CSS grid with an implicit `auto` column, and grid/flex
 * items default to `min-width: auto`, so one unbreakable string (an OOXML
 * MIME type, a long filename, a long option label) would size the whole Files
 * card to its min-content width. FIT pins the column to the container.
 */
export const FIT: React.CSSProperties = {
  ...WRAP,
  gridTemplateColumns: "minmax(0, 1fr)",
};
/** Labels and form controls never exceed their (now shrinkable) column. */
export const SHRINK: React.CSSProperties = { minWidth: 0, maxWidth: "100%" };
/** `.btn` is `white-space: nowrap`; long action labels here may wrap. */
export const BTN: React.CSSProperties = {
  ...SHRINK,
  whiteSpace: "normal",
  overflowWrap: "anywhere",
};

const short = (id: string) => (id.length > 12 ? `${id.slice(0, 12)}…` : id);

/**
 * Export of the exact SAVED version the editor holds (an editable working
 * file or an immutable source snapshot). Unsaved editor text is never read,
 * sent or cleared here. Each export is journaled before the POST; an unknown
 * outcome is resolved only by replaying the stored body (chart spec
 * included), never by rebuilding it from the current controls.
 */
export function FileExport({
  ws,
  file,
  saved,
  savedText,
  dirty,
  workVersion,
  openFile,
}: {
  ws: string;
  file: WorkspaceFile;
  /** The exact saved version loaded and verified by the editor. */
  saved: FileVersionRef | null;
  /** The verified text of `saved` (not the editor's unsaved text). */
  savedText: string | null;
  dirty: boolean;
  workVersion: number;
  /** Refreshes the file list and opens the given file in the editor. */
  openFile: (target: WorkspaceFile) => Promise<void>;
}) {
  const fileId = file.workspace_file_id;
  const [format, setFormat] = useState<ExportFormat>("txt");
  const table = useMemo(
    () =>
      savedText === null ? null : inspectSavedTable(savedText, file.mime_type),
    [savedText, file.mime_type],
  );
  const [chart, setChart] = useState<ChartSpec | null>(null);
  useEffect(() => {
    setChart(table && "table" in table ? defaultChartSpec(table.table) : null);
  }, [table]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [done, setDone] = useState<{
    body: ExportFile;
    manifest: ExportManifest;
  } | null>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const pending = usePendingCommand<ExportFile>(
    `workagent:file-export:${fileId}`,
  );
  const alive = useAlive();
  useEffect(() => {
    if (pending.restored) setUnknownOutcome(true);
  }, [pending.restored]);

  const held = pending.current;
  const heldReplayable = held !== null && isReplayableExport(held);
  const problem = saved
    ? exportProblem(format, table, chart)
    : "Waiting for the saved version to load.";

  async function exportNow() {
    setBusy(true);
    setError(null);
    setDownloaded(null);
    try {
      const out = await runJournaled<ExportFile, ExportManifest>(pending, {
        everUnknown: unknownOutcome,
        isReplayable: isReplayableExport,
        build: () =>
          saved && !problem
            ? buildExportBody(envelope(newCommandId()), saved, format, chart)
            : null,
        send: (b) => requestExport(ws, fileId, b),
        readback: (b, m) => manifestReadbackProblem(b, fileId, m),
        isAmbiguous: isAmbiguousWrite,
        alive: () => alive.current,
      });
      if (out.kind === "done") {
        setDone({ body: out.body, manifest: out.result });
        setUnknownOutcome(false);
      } else if (out.kind === "mismatch") {
        setDone(null);
        setUnknownOutcome(false);
        setError(`${out.message} Nothing is offered for download.`);
      } else if (out.kind === "failed") {
        setError(errText(out.error));
        setUnknownOutcome(out.unknownOutcome);
      } else if (out.kind === "invalid") setError(problem);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function download(m: ExportManifest) {
    setBusy(true);
    setError(null);
    try {
      const bytes = await downloadVerifiedExport(ws, m.export_id, m.blob);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: m.blob.mime_type }),
      );
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = m.filename;
        a.rel = "noopener";
        a.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      setDownloaded(m.export_id);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const setSpec = (patch: Partial<ChartSpec>) =>
    setChart((c) => (c ? { ...c, ...patch } : c));
  const locked = busy || held !== null;
  const t = table && "table" in table ? table.table : null;
  const numeric = t?.columns.filter((c) => c.numeric) ?? [];

  return (
    <div className="stack-sm" data-testid="file-export" style={FIT}>
      {held !== null && !heldReplayable ? (
        <p className="hint" role="alert" style={WRAP}>
          An export request stored by an earlier session could not be read, so
          it was not resent.{" "}
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            style={BTN}
            onClick={() => {
              pending.set(null);
              setUnknownOutcome(false);
            }}
          >
            Discard that stored request
          </button>
        </p>
      ) : null}
      {heldReplayable ? (
        <p className="hint" data-testid="export-held">
          An export of saved version {short(held.version_id)} as{" "}
          {FORMAT_LABELS[held.format]}
          {held.chart_spec ? ` (chart “${held.chart_spec.title}”)` : ""} was
          sent but its outcome is unknown
          {pending.restored ? "; it was recovered after a reload" : ""}. Retry
          replays exactly that request, chart settings included.
        </p>
      ) : null}
      <label className="field" style={{ ...SHRINK, margin: 0 }}>
        <span className="field-label">Export as</span>
        <select
          style={SHRINK}
          value={format}
          onChange={(e) => setFormat(e.target.value as ExportFormat)}
          disabled={locked}
        >
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABELS[f]}
            </option>
          ))}
        </select>
      </label>
      {FORMAT_FIDELITY[format] ? (
        <p className="small muted">{FORMAT_FIDELITY[format]}</p>
      ) : null}
      {format === "png" && t && chart ? (
        <fieldset className="stack-sm" disabled={locked} style={FIT}>
          <legend className="small">
            Chart from the saved {t.source === "csv" ? "CSV" : "workbook sheet"}{" "}
            ({t.rowCount.toLocaleString()} rows)
          </legend>
          <label className="field" style={SHRINK}>
            <span className="field-label">Categories (x-axis)</span>
            <select
              style={SHRINK}
              value={chart.category_column}
              onChange={(e) => setSpec({ category_column: e.target.value })}
            >
              {t.columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={SHRINK}>
            <span className="field-label">Aggregation</span>
            <select
              style={SHRINK}
              value={chart.aggregation}
              onChange={(e) => {
                const aggregation = e.target.value as ChartAggregation;
                setSpec(
                  aggregation === "count"
                    ? { aggregation, value_column: null }
                    : {
                        aggregation,
                        value_column:
                          chart.value_column ??
                          numeric.find((c) => c.name !== chart.category_column)
                            ?.name ??
                          null,
                      },
                );
              }}
            >
              {CHART_AGGREGATIONS.map((a) => (
                <option key={a} value={a}>
                  {a === "count" ? "count rows" : a}
                </option>
              ))}
            </select>
          </label>
          {chart.aggregation === "count" ? null : (
            <label className="field" style={SHRINK}>
              <span className="field-label">Value column (numeric)</span>
              <select
                style={SHRINK}
                value={chart.value_column ?? ""}
                onChange={(e) =>
                  setSpec({ value_column: e.target.value || null })
                }
              >
                <option value="">Choose…</option>
                {numeric.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(
            [
              ["title", "Title"],
              ["x_label", "X-axis label"],
              ["y_label", "Y-axis label"],
            ] as const
          ).map(([k, label]) => (
            <label className="field" key={k} style={SHRINK}>
              <span className="field-label">{label}</span>
              <input
                style={SHRINK}
                value={chart[k]}
                maxLength={200}
                onChange={(e) =>
                  setSpec({ [k]: e.target.value } as Partial<ChartSpec>)
                }
              />
            </label>
          ))}
        </fieldset>
      ) : null}
      {problem && held === null ? (
        <p className="small muted" data-testid="export-problem">
          {problem}
        </p>
      ) : null}
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          className="btn btn-sm"
          style={BTN}
          onClick={() => void exportNow()}
          disabled={
            busy ||
            (held !== null ? !heldReplayable : Boolean(problem) || !saved)
          }
        >
          {busy
            ? "Exporting…"
            : heldReplayable
              ? "Retry the same export"
              : `Export saved version${saved ? ` ${short(saved.version_id)}` : ""}`}
        </button>
      </div>
      {dirty ? (
        <p className="small muted" data-testid="export-saved-only">
          Exports use the last saved version, not your unsaved edit. Your edit
          stays in the editor; save it first to export it.
        </p>
      ) : null}
      {done ? (
        <ExportResult
          body={done.body}
          m={done.manifest}
          busy={busy}
          downloaded={downloaded === done.manifest.export_id}
          onDownload={() => void download(done.manifest)}
        />
      ) : null}
      {error ? (
        <p className="hint" role="alert" style={WRAP}>
          {error}
          {unknownOutcome
            ? " The export may or may not have been made. Retry replays the exact same request; nothing is re-sent automatically."
            : null}
        </p>
      ) : null}
      <EditableCopyAction
        ws={ws}
        file={file}
        workVersion={workVersion}
        openFile={openFile}
      />
    </div>
  );
}

function annotationsText(m: ExportManifest): string {
  if (m.annotations === "included") return "Human annotations included.";
  if (m.annotations === "explicit_omissions")
    return m.omissions.length > 0
      ? `Disclosed in this export as omitted: ${m.omissions.join("; ")}.`
      : "Human annotations, if any, are written into the export as text.";
  return "The source has no annotations to include.";
}

function ExportResult({
  body,
  m,
  busy,
  downloaded,
  onDownload,
}: {
  body: ExportFile;
  m: ExportManifest;
  busy: boolean;
  downloaded: boolean;
  onDownload: () => void;
}) {
  const spec = body.chart_spec;
  return (
    <div
      className="stack-sm"
      data-testid="export-result"
      data-format={m.format}
      style={FIT}
    >
      <p className="small" style={WRAP}>
        {m.filename} · {FORMAT_LABELS[m.format]} ·{" "}
        {m.blob.byte_length.toLocaleString()} bytes
      </p>
      <p className="small muted">{annotationsText(m)}</p>
      <div className="row">
        <button
          type="button"
          className="btn btn-sm"
          style={BTN}
          onClick={onDownload}
          disabled={busy}
        >
          Download (bytes checked against SHA-256)
        </button>
        {downloaded ? (
          <span className="small muted">Downloaded; bytes matched.</span>
        ) : null}
      </div>
      <details style={WRAP}>
        <summary className="small">Export details</summary>
        <dl className="small" style={WRAP}>
          <dt>Saved version</dt>
          <dd style={WRAP}>
            {m.revision_id} (input SHA-256 {m.input_sha256})
          </dd>
          <dt>Type</dt>
          <dd style={WRAP}>{m.blob.mime_type}</dd>
          <dt>Download SHA-256</dt>
          <dd data-testid="export-digest" style={WRAP}>
            {m.blob.sha256}
          </dd>
          <dt>Exporter</dt>
          <dd style={WRAP}>{m.exporter_version}</dd>
          <dt>Fidelity</dt>
          <dd style={WRAP}>
            {m.fidelity ??
              FORMAT_FIDELITY[m.format] ??
              "No format-specific limits were reported."}
          </dd>
          {m.provenance ? (
            <>
              <dt>Original source</dt>
              <dd data-testid="export-provenance" style={WRAP}>
                snapshot {m.provenance.source_snapshot_id}, original SHA-256{" "}
                {m.provenance.original_sha256}, parser{" "}
                {m.provenance.parser_version}
              </dd>
            </>
          ) : null}
        </dl>
        {spec && m.chart ? (
          <div
            className="stack-xs"
            data-testid="export-chart-details"
            style={{ ...WRAP, overflowX: "auto" }}
          >
            <p className="small" style={WRAP}>
              Chart: {spec.aggregation}
              {spec.value_column ? ` of ${spec.value_column}` : ""} by{" "}
              {spec.category_column}, computed by the exporter (
              {m.chart.computation_version}, {m.chart.decimal_precision}-digit
              decimals, {m.chart.rounding} rounding, empty values rejected) from
              input SHA-256 {m.chart.input_sha256}.
            </p>
            <table className="small" style={WRAP}>
              <thead>
                <tr>
                  <th>{spec.category_column}</th>
                  <th>{spec.aggregation}</th>
                  <th>rows</th>
                </tr>
              </thead>
              <tbody>
                {m.chart.rows.map((r) => (
                  <tr key={r.category}>
                    <td>{r.category}</td>
                    <td>{r.value}</td>
                    <td>{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </details>
    </div>
  );
}

/**
 * "Create editable copy" for an immutable DOCX/XLSX/PDF source: the backend
 * parses the original bytes into a NEW office-v1 JSON working file; the
 * source version and its extraction stay untouched. On success the list is
 * refreshed and the copy opens in the editor. Images get no such action:
 * nothing reads their content without an OCR/vision processor.
 */
export function EditableCopyAction({
  ws,
  file,
  workVersion,
  openFile,
}: {
  ws: string;
  file: WorkspaceFile;
  workVersion: number;
  openFile: (target: WorkspaceFile) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const offer = canOfferEditableCopy(file);
  const key = `workagent:office-draft:${ws}:${file.conversation_id}:${file.workspace_file_id}`;
  const pending = usePendingCommand<ImportOfficeDraft>(offer ? key : null);
  // The acknowledged answer to `pending`, journaled beside it. While held,
  // retries re-check and re-open THIS copy and never POST again.
  const known = usePendingCommand<WorkspaceFile>(
    offer ? `${key}:result` : null,
  );
  const alive = useAlive();
  useEffect(() => {
    if (pending.restored) setUnknownOutcome(true);
  }, [pending.restored]);

  if (isImageMime(file.mime_type))
    return (
      <p className="small muted" data-testid="image-not-read">
        This image is stored as-is. No OCR or vision processor is connected, so
        nothing in it has been read or understood.
      </p>
    );
  if (!offer) return null;

  const held = pending.current;
  const heldReplayable = held !== null && isReplayableEditableCopy(held);
  const result = known.current;
  // A stored result without its exact command can't be verified: discard only.
  const orphan = result !== null && !heldReplayable;
  async function run() {
    setBusy(true);
    setError(null);
    try {
      if (orphan || (held !== null && !heldReplayable)) return;
      let body = held;
      let answer = result;
      if (answer === null) {
        if (body === null) {
          body = {
            ...envelope(newCommandId()),
            expected_work_version: workVersion,
            source: {
              workspace_file_id: file.current.workspace_file_id,
              version_id: file.current.version_id,
              sha256: file.current.sha256,
            },
          };
          // Journaled BEFORE the POST, as for every other write.
          pending.set(body);
        }
        try {
          answer = await importOfficeDraft(ws, file.conversation_id, body);
        } catch (e) {
          if (!alive.current) return;
          const after = failedWriteOutcome(
            isAmbiguousWrite(e),
            unknownOutcome || pending.restored,
          );
          setUnknownOutcome(after.unknownOutcome);
          if (!after.keepPending) pending.clear(body);
          setError(errText(e));
          return;
        }
        // A dead mount, or a journal now holding another command, records
        // nothing; the live owner resolves its own command by exact replay.
        if (!alive.current || pending.current !== body) return;
        known.set(answer);
        setUnknownOutcome(false);
      }
      if (body === null) return;
      // Exact readback before anything is opened or resolved. A refusal keeps
      // both command and answer journaled (unresolved); nothing is re-sent.
      const problem = editableCopyReadbackProblem(body, answer, {
        workspaceId: ws,
        conversationId: file.conversation_id,
      });
      if (problem) {
        setError(`${problem} The request stays recorded and is not re-sent.`);
        return;
      }
      try {
        await openFile(answer);
      } catch (e) {
        if (!alive.current) return;
        setError(
          `${errText(e)} The copy was created; retry opens that same copy without creating another.`,
        );
        return;
      }
      if (!alive.current) return;
      // Resolved only now: the answer first, then the command it answers.
      if (known.clear(answer)) pending.clear(body);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="stack-sm" data-testid="editable-copy" style={FIT}>
      <p className="small muted">
        This {OFFICE_SOURCE_MIMES[file.mime_type]} is an unchanged original. An
        editable copy is a new working file in structured office-v1 JSON
        {file.mime_type === OFFICE_SOURCE_MIMES_XLSX
          ? " (sheets and cells; formulas keep their imported cached results as unverified history)"
          : file.mime_type === OFFICE_SOURCE_MIMES_PDF
            ? " (paragraphs from the PDF’s own text layer only; there is no OCR, so a scanned page without text is refused rather than read)"
            : " (paragraphs, with table rows as tab-separated lines)"}
        ; the original and its extraction stay as they are. Styles, comments,
        layout and embedded images are not carried over, and you can add your
        own notes in its annotations list.
      </p>
      {(held !== null && !heldReplayable) || orphan ? (
        <p className="hint" role="alert" style={WRAP}>
          A stored copy request could not be read, so it was not resent.{" "}
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            style={BTN}
            onClick={() => {
              known.set(null);
              pending.set(null);
              setUnknownOutcome(false);
            }}
          >
            Discard that stored request
          </button>
        </p>
      ) : null}
      {heldReplayable && result !== null ? (
        <p className="hint" data-testid="copy-known">
          The copy {result.filename} was created but is not open yet. Retry
          checks and opens that same copy; no second copy is made.
        </p>
      ) : heldReplayable ? (
        <p className="hint">
          A copy request was sent but its outcome is unknown
          {pending.restored ? "; it was recovered after a reload" : ""}. Retry
          replays exactly that request and never makes a second copy.
        </p>
      ) : null}
      <div className="row">
        <button
          type="button"
          className="btn btn-sm"
          style={BTN}
          onClick={() => void run()}
          disabled={busy || orphan || (held !== null && !heldReplayable)}
        >
          {busy
            ? "Creating…"
            : heldReplayable && result !== null
              ? "Open the created copy"
              : heldReplayable
                ? "Retry the same copy"
                : "Create editable copy"}
        </button>
      </div>
      {error ? (
        <p className="hint" role="alert" style={WRAP}>
          {error}
          {unknownOutcome
            ? " The copy may or may not have been made. Retry replays the exact same request."
            : null}
        </p>
      ) : null}
    </div>
  );
}

const OFFICE_SOURCE_MIMES_PDF = "application/pdf";
const OFFICE_SOURCE_MIMES_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
