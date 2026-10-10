"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { productApi, type S } from "@/lib/client/products";
import { ApiError } from "@/lib/contract/errors";
import { DocEdit, DocRead } from "@/components/DocBody";
import { ObservedOutput } from "@/components/ObservedOutput";
import { SandboxedView, type ViewActions } from "@/components/SandboxedView";
import { savedBody, viewBlocks } from "@/lib/document-blocks";
import {
  addRow,
  bindingStates,
  canRemoveRow,
  cellInput,
  cellValue,
  changeSummary,
  fieldHeading,
  flexibleKind,
  formatCell,
  isEmptyPayload,
  isFlexible,
  KIND_LABEL,
  pinsVersions,
  notesFrom,
  parseCell,
  rebind,
  removeRow,
  rowName,
  setCell,
  slug,
  tableChanges,
  tableCsv,
  viewActionRequest,
  type CustomView,
  type DocumentBody,
  type FlexibleBody,
  type StructuredTable,
} from "@/lib/flexible";

/** The saved version each bound piece of work is at now, by artifact id. */
export type Bound = Record<
  string,
  { revision_id: string; body_hash: string; title: string } | null
>;

type Pending =
  | { kind: "save"; id: string; base: string; body: FlexibleBody }
  | { kind: "accept"; id: string; base: string; pid: string }
  | {
      kind: "dismiss";
      id: string;
      base: string;
      pid: string;
      resolution: "keep_current" | "dismiss";
    };
/** A cell as the person typed it; only an `error` blocks saving. */
type RawCell = { text: string; error?: string };
type Draft = {
  base: string;
  body: FlexibleBody;
  pending: Pending | null;
  raw?: Record<string, RawCell>;
  /**
   * Notes exactly as typed. The body gets the tidied list (blank lines and
   * outer spaces dropped, as the service requires); the box keeps the text.
   */
  notesText?: string;
};
const cellKey = (rowId: string, key: string) => `${rowId}\u001f${key}`;

/** The same body in the shape a save sends, so unchanged work isn't "dirty". */
function normal(body: FlexibleBody): FlexibleBody {
  return flexibleKind(body) === "document"
    ? savedBody(
        (body as DocumentBody).title,
        viewBlocks((body as DocumentBody).blocks),
      )
    : body;
}
function readDraft(key: string, artifact: S["Artifact"]): Draft {
  const body = artifact.current_revision.body as FlexibleBody;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const d = JSON.parse(raw) as Draft;
      if (d.base && d.body && flexibleKind(d.body) === flexibleKind(body))
        return d;
    }
  } catch {
    /* saved server state is still available */
  }
  return {
    base: artifact.current_revision_id,
    body: structuredClone(body),
    pending: null,
  };
}
/** Problems that would make the service refuse a save, in plain words. */
function draftProblem(draft: Draft): string {
  const bad = Object.values(draft.raw ?? {}).filter((c) => c.error);
  if (bad.length)
    return `Fix ${bad.length === 1 ? "the highlighted value" : `the ${bad.length} highlighted values`} before saving.`;
  const b = draft.body;
  if (flexibleKind(b) === "document") {
    const doc = b as DocumentBody;
    if (doc.blocks.some((x) => !x.text.trim()))
      return "Every part of the document needs some text.";
  }
  if (flexibleKind(b) === "custom_view" && !(b as CustomView).fallback.trim())
    return "The readable version can’t be empty.";
  return "";
}

/** Download text made in the browser from a saved version. */
function saveText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Self-describing work: a document, a structured table or an agent-made
 * view, rendered from what the saved version says about itself. Saving,
 * proposals and history use the same paths as every other kind of work.
 */
export function FlexibleEditor({
  ws,
  cid,
  artifact,
  proposals,
  history,
  observations,
  bound,
  open,
  origin,
  stale,
  refresh,
  onDirtyChange,
}: {
  ws: string;
  cid: string;
  artifact: S["Artifact"];
  proposals: S["Proposal"][];
  history: S["Revision"][];
  observations: S["ObservationReadback"][];
  bound: Bound;
  open: boolean;
  origin: string;
  stale: boolean;
  refresh: () => Promise<unknown>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const key = `workagent:product:${ws}:${cid}:${artifact.id}`;
  const saved = artifact.current_revision.body as FlexibleBody;
  const kind = flexibleKind(saved)!;
  const [draft, setDraft] = useState<Draft>(() => readDraft(key, artifact));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const problem = draftProblem(draft);
  const dirty =
    Boolean(draft.raw && Object.keys(draft.raw).length && problem) ||
    JSON.stringify(normal(draft.body)) !== JSON.stringify(normal(saved));
  const changed = draft.base !== artifact.current_revision_id;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  function keep(next: Draft) {
    setDraft(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      setNotice(
        "Browser storage unavailable. Keep this tab open to retain the draft and retry information.",
      );
    }
  }
  const fresh = (a: S["Artifact"]): Draft => ({
    base: a.current_revision_id,
    body: structuredClone(a.current_revision.body as FlexibleBody),
    pending: null,
  });
  async function submit(action: Pending, done?: string) {
    if (busy || (!draft.pending && action.kind === "save" && problem)) return;
    const exact = draft.pending ?? action;
    keep({ ...draft, pending: exact });
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (exact.kind === "save") {
        const next = await productApi.save(
          ws,
          artifact.id,
          exact.id,
          exact.base,
          exact.body,
        );
        if (!isFlexible(next.current_revision.body))
          throw new Error("Unexpected response.");
        keep(fresh(next));
        setNotice(done ?? "Your edits are saved.");
      } else if (exact.kind === "accept") {
        const next = await productApi.accept(
          ws,
          exact.pid,
          exact.id,
          exact.base,
        );
        if (!isFlexible(next.current_revision.body))
          throw new Error("Unexpected response.");
        keep(fresh(next));
        setNotice("The proposed version is now your saved version.");
      } else {
        await productApi.dismiss(
          ws,
          exact.pid,
          exact.id,
          exact.base,
          exact.resolution,
        );
        keep({ ...draft, pending: null });
        setNotice(
          exact.resolution === "keep_current"
            ? "Kept your saved version. The proposal is closed."
            : "Proposal dismissed. Your saved version is unchanged.",
        );
      }
      await refresh();
    } catch (e) {
      if (
        !(e instanceof ApiError && e.isAmbiguousWrite) &&
        !(e instanceof TypeError)
      )
        keep({ ...draft, pending: null });
      setError(e instanceof Error ? e.message : "Could not confirm that.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || Boolean(draft.pending) || stale;
  const pendingProposals = proposals.filter((p) => p.status === "pending");
  const byWorkagent = artifact.current_revision.author_kind !== "human";
  return (
    <div className="stack product" data-kind={kind}>
      <header className="stack-sm">
        <h1>{saved.title}</h1>
        <div className="row product-meta">
          <span className="small muted">
            {KIND_LABEL[kind]} · {origin}
          </span>
          <span className="composer-spacer" />
          {kind === "structured_table" ? (
            <button
              className="link-quiet small"
              onClick={() =>
                saveText(
                  tableCsv(saved as StructuredTable),
                  `${slug(saved.title, "table")}.csv`,
                  "text/csv",
                )
              }
            >
              Download as CSV
            </button>
          ) : null}
          <button className="link-quiet small" onClick={() => void refresh()}>
            Check for updates
          </button>
        </div>
      </header>

      {stale ? (
        <p role="alert" className="notice-line">
          Connection lost. Showing what was last read; changes are paused until
          it reconnects.
        </p>
      ) : null}
      {changed ? (
        <p role="alert" className="notice-line">
          The saved version changed. Your draft is kept; discard it to see the
          new version, or save to compare.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="notice-line">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="notice-line">
          {notice}
        </p>
      ) : null}

      <section className="card result-card" aria-labelledby="result-title">
        <h2 id="result-title" className="sr-only">
          Status
        </h2>
        {kind === "structured_table" ? (
          <p className="result-headline">
            {(saved as StructuredTable).rows.length} rows ·{" "}
            {(saved as StructuredTable).fields.length} columns
          </p>
        ) : null}
        <p className="result-status" data-verified="false">
          <span className="dot" aria-hidden="true" />
          <span role="status" data-testid="product-verification">
            {byWorkagent
              ? "Draft made by Workagent. Its shape was checked; what it says hasn’t been verified."
              : "Saved by you. Nothing checks this automatically."}
          </span>
        </p>
      </section>

      {pendingProposals.map((p) => {
        const outdated = p.base_revision_id !== artifact.current_revision_id;
        const proposed = isFlexible(p.body) ? p.body : null;
        return (
          <section
            key={p.id}
            className="card decision-card product-proposal"
            data-testid="product-proposal"
            aria-labelledby={`proposal-${p.id}`}
          >
            <p className="eyebrow-caps">Waiting for you</p>
            <h2 id={`proposal-${p.id}`}>
              {outdated
                ? "This proposal is out of date"
                : "A proposed version is ready"}
            </h2>
            {outdated ? (
              <p className="decision-question" role="status">
                It was made from an earlier saved version, so it can’t replace
                your current one. Dismiss it, or ask for a new one in the
                conversation.
              </p>
            ) : null}
            <p className="small">{p.reason}</p>
            {proposed &&
            flexibleKind(proposed) === "structured_table" &&
            kind === "structured_table" ? (
              <p className="decision-question" data-testid="proposal-changes">
                {changeSummary(
                  tableChanges(
                    saved as StructuredTable,
                    proposed as StructuredTable,
                  ),
                )}
              </p>
            ) : null}
            {proposed ? (
              <details className="ids-details">
                <summary>See the proposed version</summary>
                <ReadOnly body={proposed} />
              </details>
            ) : null}
            <div className="row">
              {outdated ? null : (
                <button
                  className="btn btn-on-soft"
                  disabled={locked || dirty}
                  onClick={() =>
                    void submit({
                      kind: "accept",
                      id: crypto.randomUUID(),
                      pid: p.id,
                      base: artifact.current_revision_id,
                    })
                  }
                >
                  Apply proposed version
                </button>
              )}
              <button
                className="btn btn-quiet"
                disabled={locked}
                onClick={() =>
                  void submit({
                    kind: "dismiss",
                    id: crypto.randomUUID(),
                    pid: p.id,
                    base: artifact.current_revision_id,
                    resolution: outdated ? "dismiss" : "keep_current",
                  })
                }
              >
                {outdated ? "Dismiss proposal" : "Keep my current version"}
              </button>
            </div>
            {!outdated && dirty ? (
              <p className="small">Save or discard your changes first.</p>
            ) : null}
          </section>
        );
      })}

      {kind === "custom_view" ? (
        <ViewSurface
          ws={ws}
          cid={cid}
          artifact={artifact}
          view={saved as CustomView}
          bound={bound}
          open={open}
          stale={stale}
          refresh={refresh}
          canRebind={!locked && !dirty && !changed}
          rebindNow={() =>
            void submit(
              {
                kind: "save",
                id: crypto.randomUUID(),
                base: artifact.current_revision_id,
                body: rebind(saved as CustomView, bound),
              },
              "The view now reads the latest saved versions.",
            )
          }
        />
      ) : null}

      <WorkingCopy view={kind === "custom_view"} dirty={dirty}>
        <fieldset disabled={locked} className="stack">
          {kind === "structured_table" ? (
            <TableEditor
              saved={saved as StructuredTable}
              body={draft.body as StructuredTable}
              raw={draft.raw ?? {}}
              update={(body, raw) => keep({ ...draft, body, raw })}
              notesText={draft.notesText}
              updateNotes={(notesText) =>
                keep({
                  ...draft,
                  notesText,
                  body: {
                    ...(draft.body as StructuredTable),
                    notes: notesFrom(notesText),
                  },
                })
              }
            />
          ) : kind === "document" ? (
            <DocEdit
              blocks={viewBlocks((draft.body as DocumentBody).blocks)}
              disabled={locked}
              onChange={(blocks) =>
                keep({
                  ...draft,
                  body: savedBody((draft.body as DocumentBody).title, blocks),
                })
              }
            />
          ) : (
            <label className="field">
              <span className="field-label">Readable version</span>
              <textarea
                aria-label="Readable version"
                rows={5}
                value={(draft.body as CustomView).fallback}
                onChange={(e) =>
                  keep({
                    ...draft,
                    body: {
                      ...(draft.body as CustomView),
                      fallback: e.target.value,
                    },
                  })
                }
              />
              <span className="hint">
                Shown if the view can’t run, and to anyone who prefers text.
              </span>
            </label>
          )}
        </fieldset>
        {problem && dirty ? (
          <p role="alert" className="small" data-testid="draft-problem">
            {problem}
          </p>
        ) : null}
        <div className="row product-actions">
          {dirty ? (
            <button
              className="btn btn-primary"
              disabled={locked || Boolean(problem)}
              onClick={() =>
                void submit({
                  kind: "save",
                  id: crypto.randomUUID(),
                  base: draft.base,
                  body: structuredClone(draft.body),
                })
              }
            >
              Save my edits
            </button>
          ) : null}
          <button
            className="btn btn-quiet"
            disabled={locked}
            onClick={() => keep(fresh(artifact))}
          >
            Discard my changes
          </button>
        </div>
        <p className="hint">
          {dirty
            ? "Save to keep your changes. Saving doesn’t change anything else."
            : open
              ? "Ask in the conversation to change or extend this."
              : "This conversation has ended."}
        </p>
      </WorkingCopy>
      {draft.pending ? (
        <button
          className="btn btn-primary"
          disabled={busy || stale}
          onClick={() => void submit(draft.pending!)}
        >
          Retry same {draft.pending.kind}
        </button>
      ) : null}

      {observations.length ? (
        <details className="disclosure">
          <summary>How this was checked</summary>
          <div className="disclosure-body stack">
            {observations.map((read) => (
              <ObservedOutput
                key={read.observation.id}
                artifact={artifact}
                read={read}
                stale={stale}
              />
            ))}
          </div>
        </details>
      ) : null}

      <details className="disclosure">
        <summary>Saved history</summary>
        <div className="disclosure-body stack">
          {history.map((r) => (
            <details key={r.id} className="ids-details">
              <summary>
                Version {r.revision_number} ·{" "}
                {r.author_kind === "human" ? "your edit" : "Workagent"}
              </summary>
              {isFlexible(r.body) ? <ReadOnly body={r.body} /> : null}
              <p className="ids">
                {r.id} · {r.body_hash}
              </p>
            </details>
          ))}
        </div>
      </details>
    </div>
  );
}

/**
 * Where people edit. A view's only editable part is its readable version,
 * so for a view that sits behind one disclosure (open while unsaved).
 */
function WorkingCopy({
  view,
  dirty,
  children,
}: {
  view: boolean;
  dirty: boolean;
  children: React.ReactNode;
}) {
  const body = (
    <section className="stack product-work" aria-label="Your working copy">
      {children}
    </section>
  );
  if (!view) return body;
  return (
    <details className="disclosure" open={dirty || undefined}>
      <summary>Edit the readable version</summary>
      <div className="disclosure-body">{body}</div>
    </details>
  );
}

/** Any version, read-only. A view reads as its readable version here. */
function ReadOnly({ body }: { body: FlexibleBody }) {
  const kind = flexibleKind(body);
  if (kind === "structured_table")
    return <TableRead body={body as StructuredTable} />;
  if (kind === "document")
    return <DocRead blocks={viewBlocks((body as DocumentBody).blocks)} />;
  return <p className="view-fallback">{(body as CustomView).fallback}</p>;
}

function TableRead({ body }: { body: StructuredTable }) {
  return (
    <div
      className="product-scroll flex-table"
      tabIndex={0}
      role="region"
      aria-label={body.title}
    >
      <table>
        <thead>
          <tr>
            {body.fields.map((f) => (
              <th key={f.key} scope="col" data-type={f.type}>
                {fieldHeading(f)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.rows.map((r) => (
            <tr key={r.row_id}>
              {body.fields.map((f) => (
                <td key={f.key} data-type={f.type} data-label={fieldHeading(f)}>
                  {formatCell(f, cellValue(r, f.key))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {body.notes?.length ? (
        <ul className="small table-notes">
          {body.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Edit a table by its declared fields: each cell gets the input its type
 * calls for, read-only cells stay as text, and a value the service would
 * refuse is kept as typed and marked, never saved.
 */
function TableEditor({
  saved,
  body,
  raw,
  update,
  notesText,
  updateNotes,
}: {
  saved: StructuredTable;
  body: StructuredTable;
  raw: Record<string, RawCell>;
  update: (body: StructuredTable, raw: Record<string, RawCell>) => void;
  notesText: string | undefined;
  updateNotes: (text: string) => void;
}) {
  const savedRows = new Set(saved.rows.map((r) => r.row_id));
  const readOnly = body.fields.some((f) => !f.editable);
  const errors = Object.entries(raw).filter(([, c]) => c.error);
  function edit(rowId: string, key: string, text: string) {
    const field = body.fields.find((f) => f.key === key)!;
    const parsed = parseCell(field, text);
    const k = cellKey(rowId, key);
    if ("error" in parsed)
      update(body, { ...raw, [k]: { text, error: parsed.error } });
    else
      update(setCell(body, rowId, key, parsed.value), {
        ...raw,
        [k]: { text },
      });
  }
  return (
    <>
      <p className="hint table-hint">
        Edit any value, then save.
        {readOnly ? " Shaded columns can’t be edited." : ""}
        <span className="scroll-cue" aria-hidden="true">
          {" "}
          Scroll sideways for more columns →
        </span>
      </p>
      <div
        className="product-scroll flex-table"
        tabIndex={0}
        role="region"
        aria-label="Editable table"
      >
        <table>
          <thead>
            <tr>
              {body.fields.map((f) => (
                <th
                  key={f.key}
                  scope="col"
                  data-type={f.type}
                  data-derived={f.editable ? undefined : "true"}
                >
                  {fieldHeading(f)}
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">Row actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {body.rows.map((r, i) => {
              const name = rowName(body, r, i + 1);
              return (
                <tr key={r.row_id}>
                  {body.fields.map((f) => {
                    const value = cellValue(r, f.key);
                    const k = cellKey(r.row_id, f.key);
                    const typed = raw[k];
                    const label = `${name} ${f.label}`;
                    const locked = !f.editable && savedRows.has(r.row_id);
                    return (
                      <td
                        key={f.key}
                        data-type={f.type}
                        data-label={fieldHeading(f)}
                        data-derived={f.editable ? undefined : "true"}
                      >
                        {locked ? (
                          formatCell(f, value)
                        ) : f.type === "boolean" || f.type === "enum" ? (
                          <select
                            aria-label={label}
                            value={cellInput(value)}
                            onChange={(e) =>
                              edit(r.row_id, f.key, e.target.value)
                            }
                          >
                            <option value="">—</option>
                            {(f.type === "boolean"
                              ? [
                                  ["yes", "Yes"],
                                  ["no", "No"],
                                ]
                              : (f.enum ?? []).map((x) => [x, x])
                            ).map(([v, t]) => (
                              <option key={v} value={v}>
                                {t}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            aria-label={label}
                            aria-invalid={typed?.error ? true : undefined}
                            inputMode={
                              f.type === "integer"
                                ? "numeric"
                                : f.type === "decimal"
                                  ? "decimal"
                                  : undefined
                            }
                            value={typed?.text ?? cellInput(value)}
                            onChange={(e) =>
                              edit(r.row_id, f.key, e.target.value)
                            }
                          />
                        )}
                      </td>
                    );
                  })}
                  <td data-label="">
                    {canRemoveRow(saved, body, r.row_id) ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-quiet"
                        aria-label={`Remove ${name}`}
                        onClick={() => {
                          const next = { ...raw };
                          for (const f of body.fields)
                            delete next[cellKey(r.row_id, f.key)];
                          update(removeRow(body, r.row_id), next);
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {errors.length ? (
        <ul className="small cell-errors" role="alert">
          {errors.map(([k, c]) => {
            const [rowId, key] = k.split("\u001f");
            const n = body.rows.findIndex((r) => r.row_id === rowId);
            const row = body.rows[n];
            const field = body.fields.find((f) => f.key === key);
            return row && field ? (
              <li key={k}>
                {rowName(body, row, n + 1)} · {field.label}: {c.error}
              </li>
            ) : null;
          })}
        </ul>
      ) : null}
      <div className="row">
        <button
          type="button"
          className="btn btn-sm"
          disabled={body.rows.length >= 200}
          onClick={() =>
            update(addRow(body, `row-${crypto.randomUUID()}`), raw)
          }
        >
          Add a row
        </button>
      </div>
      <label className="field">
        <span className="field-label">Notes (one per line)</span>
        <textarea
          aria-label="Notes (one per line)"
          value={notesText ?? (body.notes ?? []).join("\n")}
          onChange={(e) => updateNotes(e.target.value)}
        />
      </label>
    </>
  );
}

/**
 * An agent-made view of saved work. The trusted shell says what it reads and
 * whether that is still current, answers only the actions the saved view
 * declares, and reports failures itself rather than trusting the view to.
 */
function ViewSurface({
  ws,
  cid,
  artifact,
  view,
  bound,
  open,
  stale,
  refresh,
  canRebind,
  rebindNow,
}: {
  ws: string;
  cid: string;
  artifact: S["Artifact"];
  view: CustomView;
  bound: Bound;
  open: boolean;
  stale: boolean;
  refresh: () => Promise<unknown>;
  canRebind: boolean;
  rebindNow: () => void;
}) {
  // A failed read clears when a read works again; a refused request stays,
  // because the view did ask for something it may not have.
  const [problem, setProblem] = useState("");
  const [refusal, setRefusal] = useState("");
  const states = bindingStates(view, bound);
  const behind = states.some((s) => s.state === "changed");
  const missing = states.some((s) => s.state === "unavailable");
  const pinned = pinsVersions(view);
  const revision = artifact.current_revision;
  const actions: ViewActions = {};
  for (const a of view.actions ?? [])
    actions[a.name] = async (payload) => {
      if (!isEmptyPayload(payload)) {
        setRefusal("The view asked for something it isn’t allowed to.");
        throw new Error("refused");
      }
      try {
        const result = await productApi.viewAction(
          ws,
          artifact.id,
          viewActionRequest(revision, view, a.name, crypto.randomUUID()),
        );
        setProblem("");
        return result;
      } catch (e) {
        if (e instanceof ApiError && e.status === 422)
          setRefusal("The view asked for something it isn’t allowed to.");
        else
          setProblem(
            e instanceof ApiError && e.status === 404
              ? "The view couldn’t read your saved work. It, or what it reads, has changed since it was made, or your access has. Anything it shows may be out of date."
              : "The view couldn’t reach your saved work. Anything it shows may be out of date.",
          );
        if (e instanceof ApiError && e.status === 404) void refresh();
        throw e;
      }
    };
  const readable = (
    <details className="disclosure" open={false}>
      <summary>Readable version</summary>
      <div className="disclosure-body">
        <p className="view-fallback">{view.fallback}</p>
      </div>
    </details>
  );
  return (
    <section className="stack view-surface" aria-label={view.title}>
      <div className="stack-sm view-trust">
        <p className="small">
          Workagent made this view. It reads your saved work and can’t change
          it; what it shows hasn’t been verified.
        </p>
        {states.length ? (
          <ul className="small view-bindings">
            {states.map(({ binding, state }) => (
              <li key={binding.name} data-state={state}>
                Reads{" "}
                <Link
                  href={`/conversations/${cid}/artifacts/${binding.artifact_id}`}
                >
                  {bound[binding.artifact_id]?.title ?? "saved work"}
                </Link>
                {state === "current"
                  ? " · current saved version"
                  : state === "changed"
                    ? " · changed since this view was made"
                    : " · not available"}
              </li>
            ))}
          </ul>
        ) : null}
        {behind ? (
          <div className="notice-line stack-sm" role="status">
            <p>
              What this view reads has been saved since it was made, so it can’t
              read it any more.
            </p>
            {pinned ? (
              <p data-testid="view-pinned">
                This view was written for that earlier version, so it can’t
                simply be pointed at the new one. Ask in the conversation for an
                updated view.
              </p>
            ) : !missing ? (
              <div className="row">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!canRebind || stale || !open}
                  onClick={rebindNow}
                >
                  Use the latest saved versions
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {!open ? (
          <p className="notice-line" role="status">
            This conversation has ended, so the view can’t read saved work.
          </p>
        ) : null}
        {/* A refused read is already explained when the work moved on. */}
        {problem && !behind ? (
          <p className="notice-line" role="alert" data-testid="view-problem">
            {problem}
          </p>
        ) : null}
        {refusal ? (
          <p className="notice-line" role="alert" data-testid="view-refusal">
            {refusal}
          </p>
        ) : null}
      </div>
      <SandboxedView
        key={`${revision.id}:${revision.body_hash}`}
        title={view.title}
        source={view.source}
        data={{}}
        actions={actions}
        fallback={<p className="view-fallback">{view.fallback}</p>}
      />
      {readable}
      <details className="disclosure">
        <summary>View source</summary>
        <div className="disclosure-body stack-sm">
          <p className="hint">
            Kept as text and only ever run inside the isolated frame above.
          </p>
          {(["html", "css", "js"] as const).map((part) =>
            view.source[part] ? (
              <pre key={part} className="product-code" aria-label={part}>
                {view.source[part]}
              </pre>
            ) : null,
          )}
        </div>
      </details>
    </section>
  );
}
