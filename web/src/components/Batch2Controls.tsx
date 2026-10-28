"use client";
import { useState } from "react";
import { newCommandId } from "@/lib/client/api";
import {
  commandBody,
  documentApi,
  saveOriginal,
  queueApi,
  runApi,
} from "@/lib/client/batch2-api";
import { DOCUMENT_ACCEPT, type StagedEntry } from "@/lib/client/documents";
import { usePendingCommand } from "@/lib/client/pending-command";
import { ApiError } from "@/lib/contract/errors";
import type {
  DocumentDetail,
  DocumentMetadata,
  QueuedMessage,
  RunCheckpoint,
} from "@/lib/contract/batch2";
import {
  continueView,
  coverageLine,
  documentStatus,
  continueTarget,
  queuedView,
  sizeLabel,
  type RunStopReason,
} from "@/lib/batch2-view";
import { ErrorNotice, StatusBadge } from "./ui";

const unconfirmed = (e: unknown) => e instanceof ApiError && e.isAmbiguousWrite;

// ---------------------------------------------------------------- queue --

/** The server's queued messages for this conversation, oldest first. */
export function QueuedMessages({
  ws,
  cid,
  items,
  refresh,
}: {
  ws: string;
  cid: string;
  items: QueuedMessage[] | null;
  refresh: () => void;
}) {
  const open = (items ?? []).filter(
    (q) => q.state === "pending" || q.state === "held",
  );
  const done = (items ?? []).filter(
    (q) => q.state === "admitted" || q.state === "cancelled",
  );
  if (!open.length && !done.length) return null;
  return (
    <section
      className="stack-sm"
      aria-labelledby="queued-title"
      data-testid="queued"
    >
      <h2 id="queued-title" className="section-title">
        Queued for later
      </h2>
      {open.length ? (
        <ol className="work-list">
          {open
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((q) => (
              <QueuedRow key={q.id} ws={ws} cid={cid} q={q} refresh={refresh} />
            ))}
        </ol>
      ) : (
        <p className="small muted">Nothing waiting.</p>
      )}
      {done.length ? (
        <details className="ids-details">
          <summary>Earlier queued messages ({done.length})</summary>
          <ul className="ids small">
            {done.map((q) => (
              <li key={q.id}>
                {queuedView(q).label}
                {q.run_id ? (
                  <>
                    {" · "}
                    <a href={`#run-${q.run_id}`}>where it ran</a>
                  </>
                ) : null}
                {" · "}
                <span className="clamp-2">{q.intent.text}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function QueuedRow({
  ws,
  cid,
  q,
  refresh,
}: {
  ws: string;
  cid: string;
  q: QueuedMessage;
  refresh: () => void;
}) {
  const v = queuedView(q);
  const cmd = usePendingCommand<
    ReturnType<typeof commandBody<{ expected_queue_version: number }>>
  >(`workagent:pending:${ws}:conversation:${cid}:queue-cancel:${q.id}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cancel = async () => {
    setBusy(true);
    setError(null);
    const body =
      cmd.current ??
      commandBody(newCommandId(), { expected_queue_version: q.queue_version });
    if (!cmd.current) cmd.set(body);
    try {
      await queueApi.cancel(ws, cid, q.id, body);
      cmd.clear(body);
      refresh();
    } catch (e) {
      if (!unconfirmed(e)) {
        cmd.clear(body);
        refresh();
      }
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="stack-xs" data-queued={q.id} data-state={q.state}>
      <div className="row wrap">
        <StatusBadge
          label={v.label}
          tone={q.state === "held" ? "status-attention" : "status-working"}
        />
        <span className="small clamp-2">{q.intent.text}</span>
      </div>
      {v.note ? <p className="small muted">{v.note}</p> : null}
      {q.intent.document_refs?.length || q.intent.attachments?.length ? (
        <p className="small muted">
          With{" "}
          {(q.intent.document_refs?.length ?? 0) +
            (q.intent.attachments?.length ?? 0)}{" "}
          attached file(s)
        </p>
      ) : null}
      {cmd.current && !busy ? (
        <p className="hint" role="status">
          Cancelling wasn’t confirmed. Cancelling again replays the same
          request.
        </p>
      ) : null}
      {error && !unconfirmed(error) ? <ErrorNotice error={error} /> : null}
      {v.cancellable ? (
        <div className="row">
          <button
            type="button"
            className="link-quiet small"
            onClick={() => void cancel()}
            disabled={busy}
          >
            {busy ? "Cancelling…" : "Cancel this queued message"}
          </button>
        </div>
      ) : null}
    </li>
  );
}

// ----------------------------------------------------------------- stop --

type StopBody = ReturnType<
  typeof commandBody<{ expected_work_version: number; run_id: string }>
>;

/**
 * Stops exactly the run shown here, at the version shown. Not ending the
 * conversation, not pausing a hand-over: the conversation stays open.
 */
export function StopRun({
  ws,
  cid,
  runId,
  version,
  refresh,
}: {
  ws: string;
  cid: string;
  runId: string;
  version: number;
  refresh: () => void;
}) {
  const cmd = usePendingCommand<StopBody>(
    `workagent:pending:${ws}:conversation:${cid}:stop:${runId}`,
  );
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const stop = async () => {
    setBusy(true);
    setError(null);
    const body =
      cmd.current ??
      commandBody(newCommandId(), {
        expected_work_version: version,
        run_id: runId,
      });
    if (!cmd.current) cmd.set(body);
    try {
      await runApi.stop(ws, cid, body);
      cmd.clear(body);
      setConfirm(false);
      refresh();
    } catch (e) {
      if (!unconfirmed(e)) {
        cmd.clear(body);
        refresh();
      }
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const pending = Boolean(cmd.current) && !busy;
  return (
    <div className="stack-xs" data-testid="stop-run" data-run={runId}>
      {confirm || pending ? (
        <div className="row wrap">
          <span className="small muted">
            Stops only this run. The conversation stays open and what’s saved is
            kept.
          </span>
          <button
            type="button"
            className="btn btn-sm btn-danger-quiet"
            onClick={() => void stop()}
            disabled={busy}
          >
            {busy
              ? "Stopping…"
              : pending
                ? "Stop again (same request)"
                : "Stop this run"}
          </button>
          {!pending ? (
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setConfirm(false)}
              disabled={busy}
            >
              Keep going
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="link-quiet small"
          onClick={() => setConfirm(true)}
        >
          Stop this run…
        </button>
      )}
      {pending ? (
        <p className="hint" role="status">
          Stopping wasn’t confirmed. Stopping again replays the same request.
        </p>
      ) : null}
      {error && !unconfirmed(error) ? (
        error instanceof ApiError && error.isVersionConflict ? (
          <p className="hint" role="status">
            This run changed since you looked; nothing was stopped.
          </p>
        ) : (
          <ErrorNotice error={error} />
        )
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------- continue --

type ContinueBody = ReturnType<
  typeof commandBody<{
    expected_work_version: number;
    checkpoint_id: string;
    checkpoint_hash: string;
  }>
>;

/** Explicit Continue from the exact latest checkpoint; never automatic. */
export function ContinueRun({
  ws,
  cid,
  version,
  checkpoints,
  latestRunId,
  stopReason = null,
  refresh,
}: {
  ws: string;
  cid: string;
  version: number;
  checkpoints: RunCheckpoint[] | null;
  /** The conversation's latest run; checkpoints of earlier runs never qualify. */
  latestRunId: string | null;
  /** That run's recorded stop reason. */
  stopReason?: RunStopReason;
  refresh: () => void;
}) {
  const cmd = usePendingCommand<ContinueBody>(
    `workagent:pending:${ws}:conversation:${cid}:continue`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const latest = continueTarget(checkpoints ?? [], latestRunId);
  const view = continueView(latest, stopReason);
  if (!view && !cmd.current) return null;
  const go = async () => {
    if (!latest && !cmd.current) return;
    setBusy(true);
    setError(null);
    const body =
      cmd.current ??
      commandBody(newCommandId(), {
        expected_work_version: version,
        checkpoint_id: latest!.checkpoint_id,
        checkpoint_hash: latest!.checkpoint_hash,
      });
    if (!cmd.current) cmd.set(body);
    try {
      await runApi.continue(ws, cid, body);
      cmd.clear(body);
      refresh();
    } catch (e) {
      if (!unconfirmed(e)) {
        cmd.clear(body);
        refresh();
      }
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const pending = Boolean(cmd.current) && !busy;
  return (
    <div className="stack-xs" data-testid="continue-run">
      {view?.kind === "blocked" && !pending ? (
        <p className="small muted" data-testid="continue-blocked">
          {view.text}
          {view.parked ? (
            <>
              {" "}
              <a href="#follow-up" data-testid="continue-parked-next">
                Change the next step
              </a>
            </>
          ) : null}
        </p>
      ) : (
        <div className="row wrap">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void go()}
            disabled={busy}
          >
            {busy
              ? "Continuing…"
              : pending
                ? "Continue again (same request)"
                : "Continue from where it stopped"}
          </button>
          <span className="small muted">
            Picks up from the last saved point. Nothing is redone.
          </span>
        </div>
      )}
      {pending ? (
        <p className="hint" role="status">
          Continuing wasn’t confirmed. Continuing again replays the same
          request.
        </p>
      ) : null}
      {error && !unconfirmed(error) ? (
        <p className="hint" role="status">
          Not continued:{" "}
          {error instanceof Error ? error.message : "the request was refused"}.
          Nothing was redone; your work is unchanged.
        </p>
      ) : null}
      {latest ? (
        <details className="ids-details">
          <summary>Checkpoint</summary>
          <p className="ids">
            {latest.checkpoint_id} · {latest.checkpoint_kind} ·{" "}
            {latest.data.last_observed_phase} · {latest.checkpoint_hash}
          </p>
        </details>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ documents --

/** Choose PDF/DOCX/XLSX originals and see their upload state. */
export function DocumentPicker({
  docs,
  error,
  locked,
  onAdd,
  onRemove,
  problems = [],
  onReattach,
  recovery = [],
}: {
  docs: StagedEntry[];
  error: string;
  locked: boolean;
  onAdd: (files: FileList | null) => void;
  onRemove: (index: number) => void;
  /** Per entry: why it must be reconciled before anything sends (or null). */
  problems?: (string | null)[];
  /** Explicit recovery: re-stage the kept bytes as a new upload. */
  onReattach?: (index: number) => void;
  /** Explicit recovery actions for a blocked restoration. */
  recovery?: { label: string; run: () => void }[];
}) {
  return (
    <div className="stack-xs" data-testid="document-picker">
      {docs.length ? (
        <ul className="row wrap" aria-label="Documents to send">
          {docs.map((d, i) => (
            <li key={d.doc.sha256} className="chip small" data-upload={d.state}>
              {d.doc.filename} · {sizeLabel(d.doc.byte_length)} ·{" "}
              {d.state === "uploading"
                ? "Uploading…"
                : d.state === "uploaded"
                  ? "Uploaded"
                  : d.state === "unknown"
                    ? "Upload not confirmed; sending again replays the same upload"
                    : "Uploads when you send"}
              {d.durable ? "" : " · not kept on this device"}
              {problems[i] ? (
                <>
                  {" "}
                  <span role="alert">{problems[i]}</span>
                  {onReattach ? (
                    <button
                      type="button"
                      className="link-quiet small"
                      onClick={() => onReattach(i)}
                    >
                      Use kept copy as a new upload
                    </button>
                  ) : null}
                </>
              ) : null}
              {(!locked || problems[i]) && d.state !== "uploading" ? (
                <button
                  type="button"
                  className="link-quiet small"
                  aria-label={`Remove ${d.doc.filename}`}
                  onClick={() => onRemove(i)}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="hint" role="alert">
          {error}
        </p>
      ) : null}
      {recovery.length ? (
        <div className="row wrap" data-testid="document-recovery">
          {recovery.map((r) => (
            <button
              key={r.label}
              type="button"
              className="btn btn-sm"
              onClick={r.run}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}
      {!locked && docs.length < 2 ? (
        <label className="link-quiet small">
          Attach PDF, Word or Excel (up to 2, 5 MB each)
          <input
            type="file"
            className="sr-only"
            accept={DOCUMENT_ACCEPT}
            multiple
            onChange={(e) => {
              onAdd(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      ) : null}
    </div>
  );
}

/** Documents retained in this conversation: metadata first, text on demand. */
export function ConversationDocuments({
  ws,
  cid,
  items,
}: {
  ws: string;
  cid: string;
  items: DocumentMetadata[] | null;
}) {
  if (!items?.length) return null;
  return (
    <section
      className="stack-sm"
      aria-labelledby="docs-title"
      data-testid="documents"
    >
      <h2 id="docs-title" className="section-title">
        Documents
      </h2>
      <ul className="work-list">
        {items.map((d) => (
          <DocumentRow key={d.document_id} ws={ws} cid={cid} d={d} />
        ))}
      </ul>
    </section>
  );
}

function DocumentRow({
  ws,
  cid,
  d,
}: {
  ws: string;
  cid: string;
  d: DocumentMetadata;
}) {
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const coverage = coverageLine(d.coverage);
  const readable = d.status === "extracted" || d.status === "truncated";
  const download = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveOriginal(ws, cid, d);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <li
      className="stack-xs document-row"
      id={`document-${d.document_id}`}
      data-document={d.document_id}
      data-status={d.status}
    >
      <div className="row wrap">
        <span className="work-row-title">{d.filename}</span>
        <StatusBadge
          label={documentStatus(d)}
          tone={
            readable
              ? d.status === "truncated"
                ? "status-attention"
                : ""
              : "status-attention"
          }
        />
      </div>
      <p className="small muted">
        {sizeLabel(d.byte_length)} · original kept in full
        {readable && coverage ? ` · ${coverage}` : ""}
      </p>
      {!readable && d.reason ? <p className="small">{d.reason}</p> : null}
      <div className="row wrap">
        <button
          type="button"
          className="link-quiet small"
          onClick={() => void download()}
          disabled={saving}
        >
          {saving ? "Preparing…" : "Download original"}
        </button>
      </div>
      {error ? <ErrorNotice error={error} /> : null}
      <details
        className="ids-details"
        onToggle={(e) => {
          if (!(e.currentTarget as HTMLDetailsElement).open || detail) return;
          documentApi.get(ws, cid, d.document_id).then(setDetail, setError);
        }}
      >
        <summary>{readable ? "Text that was read" : "Details"}</summary>
        <div className="stack-xs">
          {d.coverage.omissions.length ? (
            <ul className="small muted">
              {d.coverage.omissions.map((o) => (
                <li key={o}>Not included: {o}</li>
              ))}
            </ul>
          ) : null}
          {readable ? (
            detail ? (
              <pre
                className="document-read-text small"
                data-testid="document-text"
              >
                {detail.text}
              </pre>
            ) : (
              <p className="small muted">Loading…</p>
            )
          ) : (
            <p className="small muted">
              No text was read, so nothing from this file is used as text.
            </p>
          )}
          <p className="ids">
            {d.document_id} · sha256 {d.sha256} · {d.parser_version}
          </p>
        </div>
      </details>
    </li>
  );
}

/** Documents a sent message referenced: names and read status, no text. */
export function MessageDocuments({
  docs,
  href,
}: {
  docs: NonNullable<import("@/lib/contract/types").ChatMessage["documents"]>;
  href: (documentId: string) => string;
}) {
  return (
    <ul
      className="row wrap"
      aria-label="Documents sent"
      data-testid="message-documents"
    >
      {docs.map((d) => (
        <li key={d.document_id} className="chip small" data-status={d.status}>
          <a href={href(d.document_id)}>{d.filename}</a> ·{" "}
          {sizeLabel(d.byte_length)} · {documentStatus(d)}
        </li>
      ))}
    </ul>
  );
}
