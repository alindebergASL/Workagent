"use client";
import { type Ref, useCallback, useEffect, useRef, useState } from "react";
import { newCommandId } from "@/lib/client/api";
import { ApiError, describeError } from "@/lib/contract/errors";
import { usePendingCommand } from "@/lib/client/pending-command";
import { scopedSession } from "@/lib/client/session-scope";

function errText(e: unknown): string {
  // A locally raised integrity refusal (status 0) is already plain language.
  if (e instanceof ApiError && e.status === 0 && e.code === "validation_error")
    return e.message;
  const d = describeError(e);
  return `${d.title}. ${d.nextAction}`;
}

const isAmbiguousWrite = (e: unknown): boolean =>
  e instanceof ApiError && e.isAmbiguousWrite;
import {
  contentProblem,
  encodeForSave,
  filenameProblem,
  mimeForFilename,
  readComplete,
  sha256HexOfText,
  toDisplayText,
  utf8Length,
  type CreateWorkspaceFile as CreateBody,
  type EditWorkspaceFile as EditBody,
  type FileComparison,
  type FileRange,
  type FileVersionRef,
  type WorkspaceFile,
  type WorkspaceFilePage,
} from "@/lib/files-contract";
import {
  clearFileDraft,
  draftMatchesBase,
  draftMatchesSavedBody,
  failedWriteOutcome,
  readFileDraft,
  writeFileDraft,
} from "@/lib/file-draft";
import {
  compareVersions,
  createFile,
  editFile,
  envelope,
  listFiles,
  readVersion,
} from "@/lib/client/workspace-files";
import { client, meta, unwrap } from "@/lib/client/real-api";
import { parseWorkSnapshot } from "@/lib/contract/work-events";
import { ArtifactCitations, ResearchSources } from "./ResearchSources";
import { BTN, FileExport, FIT, SHRINK, WRAP } from "./FileExport";
import { openTargetProblem } from "@/lib/office-export";

interface CitationBinding {
  artifactId: string;
  revisionId: string;
  bodyHash: string;
}

/**
 * The artifact revision and body hash behind one exact saved file version,
 * read from the conversation's canonical work snapshot. Only the parsed,
 * frozen snapshot is consulted, and only an artifact whose current revision
 * IS that saved version binds; a moved head binds nothing rather than the
 * wrong revision.
 */
async function savedCitationBinding(
  ws: string,
  cid: string,
  versionId: string,
  signal: AbortSignal,
): Promise<CitationBinding | null> {
  const snap = parseWorkSnapshot(
    await unwrap(
      client.GET("/v1/workspaces/{workspace_id}/work-snapshot", {
        params: {
          path: { workspace_id: ws },
          query: { conversation_id: cid },
          header: meta(),
        },
        signal,
      }),
    ),
  );
  if (snap.conversation_id !== cid) return null;
  const a = snap.artifacts.find((x) => x.current_revision_id === versionId);
  return a
    ? { artifactId: a.id, revisionId: versionId, bodyHash: a.body_hash }
    : null;
}

/**
 * Working files that belong to this conversation. Every save is bound to the
 * exact version and bytes it started from; nothing here rebases silently or
 * mutates twice for one intent. Content is handled as inert text only.
 */
export function WorkspaceFiles({
  ws,
  cid,
  workVersion,
}: {
  ws: string;
  cid: string;
  workVersion: number;
}) {
  const [page, setPage] = useState<WorkspaceFilePage | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // The control that opened a file (e.g. "Open the created copy") leaves
  // with the old editor, so focus moves to the newly opened editor's heading.
  const focusOpened = useRef<string | null>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOpened.current === null || focusOpened.current !== selected)
      return;
    focusOpened.current = null;
    editorHeading.current?.focus();
  }, [selected]);

  const refresh = useCallback(async () => {
    try {
      setPage(await listFiles(ws, cid));
      setListError(null);
    } catch (e) {
      setListError(errText(e));
    }
  }, [ws, cid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A new file (e.g. an editable office copy) opens only after a fresh list
  // read confirms that exact file and version. Any failure is thrown to the
  // caller (which keeps its journal) instead of selecting an unconfirmed id.
  const openFile = useCallback(
    async (target: WorkspaceFile) => {
      const next = await listFiles(ws, cid);
      setPage(next);
      setListError(null);
      const problem = openTargetProblem(next, target);
      if (problem)
        throw new ApiError({
          code: "validation_error",
          status: 0,
          message: problem,
        });
      focusOpened.current = target.workspace_file_id;
      setSelected(target.workspace_file_id);
    },
    [ws, cid],
  );

  const file = page?.items.find((f) => f.workspace_file_id === selected);
  return (
    <section
      className="card card-quiet stack-sm"
      aria-labelledby="wfiles-title"
      style={FIT}
    >
      <h2 id="wfiles-title">Files</h2>
      {listError ? (
        <p className="hint" role="alert">
          {listError}
        </p>
      ) : null}
      {page && page.items.length === 0 ? (
        <p className="small muted">
          No working files in this conversation yet.
        </p>
      ) : null}
      <ul
        className="stack-sm"
        style={{ ...FIT, listStyle: "none", padding: 0 }}
      >
        {(page?.items ?? []).map((f) => (
          <li
            key={f.workspace_file_id}
            className="row"
            style={{ ...SHRINK, flexWrap: "wrap", gap: 8 }}
          >
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              style={{ ...WRAP, whiteSpace: "normal", textAlign: "start" }}
              aria-expanded={selected === f.workspace_file_id}
              onClick={() =>
                setSelected((s) =>
                  s === f.workspace_file_id ? null : f.workspace_file_id,
                )
              }
            >
              {f.filename}
            </button>
            <span className="small muted" style={WRAP}>
              {f.mime_type} · {f.byte_length.toLocaleString()} bytes
              {f.editable ? "" : " · read-only evidence"}
            </span>
          </li>
        ))}
      </ul>
      <ResearchSources key={`${ws}:${cid}`} ws={ws} cid={cid} />
      {file ? (
        <FileEditor
          key={file.workspace_file_id}
          ws={ws}
          file={file}
          workVersion={workVersion}
          refreshList={refresh}
          openFile={openFile}
          headingRef={editorHeading}
        />
      ) : null}
      <FileCreator
        ws={ws}
        cid={cid}
        workVersion={workVersion}
        refreshList={refresh}
      />
    </section>
  );
}

interface CreatorDraft {
  filename: string;
  content: string;
}

function FileCreator({
  ws,
  cid,
  workVersion,
  refreshList,
}: {
  ws: string;
  cid: string;
  workVersion: number;
  refreshList: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  // The full command (envelope and body) is journaled to this tab BEFORE the
  // POST. An ambiguous outcome is only ever resolved by replaying that exact
  // stored request — same request_id, same command_id, same bytes — never by
  // regenerating a body from whatever the fields say now.
  const pending = usePendingCommand<CreateBody>(
    `workagent:file-create:${ws}:${cid}`,
  );
  const draftKey = `workagent:file-new:${ws}:${cid}`;
  // Mount fence: a reply that lands after this mount is gone may resolve only
  // its own journaled command; it must never journal a new command, clear a
  // newer mount's journal, or drop a draft it no longer owns.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = scopedSession.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as CreatorDraft;
        setFilename(d.filename);
        setContent(d.content);
        setOpen(true);
      }
    } catch {
      /* unreadable or unavailable: nothing to restore */
    }
  }, [draftKey]);

  useEffect(() => {
    if (pending.restored) {
      setOpen(true);
      setUnknownOutcome(true);
      const src = pending.current?.source;
      if (src && src.kind === "text") {
        setFilename(src.filename);
        setContent(src.content);
      }
    }
  }, [pending.restored]);

  function keep(next: CreatorDraft) {
    try {
      scopedSession.setItem(draftKey, JSON.stringify(next));
    } catch {
      /* storage unavailable: the in-memory text still exists */
    }
  }
  function dropDraft() {
    try {
      scopedSession.removeItem(draftKey);
    } catch {
      /* ignore */
    }
  }

  const problem = filenameProblem(filename) ?? contentProblem(content);
  async function submit() {
    setBusy(true);
    setError(null);
    let body = pending.current;
    try {
      if (!body) {
        const mime = mimeForFilename(filename);
        if (problem || !mime) {
          setError(problem);
          return;
        }
        const sha256 = await sha256HexOfText(content);
        // The tab may have remounted while hashing; a dead mount never
        // journals a new command over whatever the live mount holds.
        if (!alive.current) return;
        body = {
          ...envelope(newCommandId()),
          expected_work_version: workVersion,
          source: { kind: "text", filename, mime_type: mime, content, sha256 },
        };
        pending.set(body);
      }
      await createFile(ws, cid, body);
      // Fenced BEFORE any persistent mutation: a dead mount's in-memory copy
      // still matches the journal, so clearing it here would strand a live
      // remount mid-replay of the same envelope. The live mount (or the next
      // one, after a restore) resolves the journal by its own exact replay.
      if (!alive.current) return;
      // Resolve exactly this command; a reply for a command whose journal
      // entry has since been replaced resolves nothing.
      const owned = pending.clear(body);
      if (!owned) return;
      dropDraft();
      setUnknownOutcome(false);
      setFilename("");
      setContent("");
      setOpen(false);
      await refreshList();
    } catch (e) {
      // A dead mount neither reports nor resolves; its journal stays for the
      // live mount's exact replay.
      if (!alive.current) return;
      setError(errText(e));
      // A definite refusal of a never-ambiguous command ends it; the text
      // stays for correction and the next send is a fresh command. Once any
      // attempt's outcome was unknown (including a journal restored after a
      // reload), even a later definitive refusal keeps the journal: the
      // earlier attempt may have committed, and only replaying this exact
      // envelope avoids a duplicate effect.
      const after = failedWriteOutcome(
        isAmbiguousWrite(e),
        unknownOutcome || pending.restored,
      );
      setUnknownOutcome(after.unknownOutcome);
      // A definite refusal resolves only this exact command, never a newer
      // journal entry written by a later mount.
      if (!after.keepPending && body) pending.clear(body);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <div className="row">
        <button
          type="button"
          className="btn btn-sm"
          style={BTN}
          onClick={() => setOpen(true)}
        >
          New file…
        </button>
      </div>
    );
  const held = pending.current !== null;
  return (
    <div className="stack-sm" style={FIT}>
      <label className="field">
        <span className="field-label">
          Filename (.txt, .md, .markdown, .csv or .json)
        </span>
        <input
          value={filename}
          onChange={(e) => {
            setFilename(e.target.value);
            keep({ filename: e.target.value, content });
          }}
          disabled={busy || held}
          maxLength={85}
        />
      </label>
      <label className="field">
        <span className="field-label">Text</span>
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            keep({ filename, content: e.target.value });
          }}
          rows={6}
          disabled={busy || held}
        />
      </label>
      {held ? (
        <p className="hint">
          This create was sent but its outcome is unknown.
          {pending.restored ? " It was recovered after a reload." : ""} Retry
          replays the identical request (the service recognises it and never
          records it twice). A file with this name appearing in the list is not
          by itself proof that this exact request succeeded.
        </p>
      ) : null}
      {error ? (
        <p className="hint" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={BTN}
          onClick={() => void submit()}
          disabled={busy || (!held && Boolean(problem))}
        >
          {busy ? "Creating…" : held ? "Retry the same create" : "Create file"}
        </button>
        {unknownOutcome ? (
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            style={BTN}
            onClick={() => void refreshList()}
            disabled={busy}
          >
            Refresh the list
          </button>
        ) : null}
        {/* No abandon action while a create is journaled: the request may
            already have committed server-side, and dropping the journal would
            let a fresh command record the same intent twice. It resolves only
            by replaying the exact request or by a definite refusal of a
            never-ambiguous attempt. */}
        {held ? null : (
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            style={BTN}
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Not now
          </button>
        )}
      </div>
    </div>
  );
}

interface Loaded {
  ref: FileVersionRef;
  display: string;
  hasBom: boolean;
  newline: FileRange["newline"];
  last: FileRange;
}

function FileEditor({
  ws,
  file,
  workVersion,
  refreshList,
  openFile = async () => {
    throw new ApiError({
      code: "validation_error",
      status: 0,
      message: "Opening another file is not available here.",
    });
  },
  headingRef,
}: {
  ws: string;
  file: WorkspaceFile;
  workVersion: number;
  refreshList: () => Promise<void>;
  openFile?: (target: WorkspaceFile) => Promise<void>;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  // The editor is pinned to the exact version it loaded; a newer current
  // version arriving later is announced via the list, never swapped under an
  // active edit, and a save is always read back from its returned ref.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [consent, setConsent] = useState(false);
  const [staleDraft, setStaleDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const [previousRef, setPreviousRef] = useState<FileVersionRef | null>(null);
  const [comparison, setComparison] = useState<FileComparison | null>(null);
  const pending = usePendingCommand<EditBody>(
    `workagent:file-save:${file.workspace_file_id}`,
  );
  const dirtyRef = useRef(false);
  const loadedRef = useRef<Loaded | null>(null);
  // Mount fence: a reply that lands after this mount is gone may resolve only
  // its own journaled command; it must never journal a new command, clear a
  // newer mount's journal, or drop a draft it no longer owns.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fileId = file.workspace_file_id;
  const current = file.current;

  useEffect(() => {
    if (loadedRef.current?.ref.version_id === current.version_id) return;
    let cancelled = false;
    void (async () => {
      try {
        const { last, text: exact } = await readComplete(current, (offset) =>
          readVersion(ws, fileId, current.version_id, current.sha256, offset),
        );
        // A result landing after the user started typing must not replace
        // their active edit.
        if (cancelled || dirtyRef.current) return;
        const next: Loaded = {
          ref: current,
          display: toDisplayText(exact),
          hasBom: last.has_utf8_bom,
          newline: last.newline,
          last,
        };
        loadedRef.current = next;
        setLoaded(next);
        const draft = readFileDraft(fileId);
        if (
          draft &&
          draftMatchesBase(draft, current.version_id, current.sha256)
        ) {
          setText(draft.content);
          setDirty(true);
          dirtyRef.current = true;
        } else {
          setText(next.display);
          if (draft) setStaleDraft(draft.content);
        }
      } catch (e) {
        if (!cancelled) setError(errText(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ws, fileId, current.version_id, current.sha256, current]);

  // Citations follow the exact SAVED version this editor holds, never the
  // list's moving head or unsaved text; looking them up never touches the
  // editor's text or dirty state.
  const savedVersion = file.editable ? (loaded?.ref.version_id ?? null) : null;
  const [citations, setCitations] = useState<CitationBinding | null>(null);
  useEffect(() => {
    setCitations(null);
    if (!savedVersion) return;
    const ac = new AbortController();
    savedCitationBinding(ws, file.conversation_id, savedVersion, ac.signal)
      .then((b) => {
        if (!ac.signal.aborted) setCitations(b);
      })
      .catch(() => {
        /* unreadable or refused: no citations are bound */
      });
    return () => ac.abort();
  }, [ws, file.conversation_id, savedVersion]);

  function edit(next: string) {
    setText(next);
    const changed = loaded === null || next !== loaded.display;
    setDirty(changed);
    dirtyRef.current = changed;
    if (loaded && changed)
      writeFileDraft({
        workspace_file_id: fileId,
        base_version_id: loaded.ref.version_id,
        base_sha256: loaded.ref.sha256,
        content: next,
        saved_at: new Date().toISOString(),
      });
  }

  const needsConsent =
    loaded !== null &&
    (loaded.newline === "mixed" || loaded.newline === "cr") &&
    dirty;

  async function save() {
    if (!loaded && !pending.current) return;
    setBusy(true);
    setError(null);
    let body = pending.current;
    try {
      if (!body) {
        const enc = encodeForSave(text, loaded!.hasBom, loaded!.newline);
        if (enc.normalizes && !consent) return;
        const problem = contentProblem(enc.content);
        if (problem) {
          setError(problem);
          return;
        }
        const sha256 = await sha256HexOfText(enc.content);
        // The panel may have unmounted while hashing; a dead mount never
        // journals a new command over whatever the live mount holds.
        if (!alive.current) return;
        body = {
          ...envelope(newCommandId()),
          expected_work_version: workVersion,
          base_version_id: loaded!.ref.version_id,
          base_sha256: loaded!.ref.sha256,
          content: enc.content,
          sha256,
        };
        // Journaled BEFORE the POST; an ambiguous outcome is resolved only by
        // replaying this exact request, never a rebuilt one.
        pending.set(body);
      }
      const prev: FileVersionRef = {
        workspace_file_id: fileId,
        version_id: body.base_version_id,
        sha256: body.base_sha256,
      };
      const saved = await editFile(ws, fileId, body);
      // Fenced BEFORE any persistent mutation, as for a create: a dead
      // mount's acknowledgement must not clear the journal (or draft) that a
      // live remount is replaying; that replay resolves them itself.
      if (!alive.current) return;
      // Resolve exactly this envelope, and clear only the draft generation it
      // actually sent: a draft holding newer human edits survives.
      const owned = pending.clear(body);
      if (!owned) return;
      const draft = readFileDraft(fileId);
      const ownsDraft = draft !== null && draftMatchesSavedBody(draft, body);
      if (ownsDraft) clearFileDraft(fileId);
      setUnknownOutcome(false);
      // Bind the editor to the exact accepted ref the service returned, via a
      // verified readback — never the list's moving head.
      const { last, text: exact } = await readComplete(
        saved.current,
        (offset) =>
          readVersion(
            ws,
            fileId,
            saved.current.version_id,
            saved.current.sha256,
            offset,
          ),
      );
      if (!alive.current) return;
      const next: Loaded = {
        ref: saved.current,
        display: toDisplayText(exact),
        hasBom: last.has_utf8_bom,
        newline: last.newline,
        last,
      };
      loadedRef.current = next;
      setLoaded(next);
      setText(next.display);
      // A draft this envelope did not send holds newer human edits (or an
      // older version's recovery); it stays stored and is surfaced as
      // recoverable, never deleted or silently rebased onto the new head.
      setStaleDraft(draft !== null && !ownsDraft ? draft.content : null);
      setDirty(false);
      dirtyRef.current = false;
      setConsent(false);
      setPreviousRef(prev);
      setComparison(null);
      await refreshList();
    } catch (e) {
      if (!alive.current) return;
      setError(errText(e));
      // As for a create: once this save's outcome has ever been unknown
      // (including a journal restored after a reload), a later definitive
      // refusal never drops the journal — the earlier attempt may have
      // committed, and only the exact replay avoids a duplicate version.
      const after = failedWriteOutcome(
        isAmbiguousWrite(e),
        unknownOutcome || pending.restored,
      );
      setUnknownOutcome(after.unknownOutcome);
      // A definite refusal resolves only this exact envelope, never a newer
      // journal entry written by a later mount.
      if (!after.keepPending && body) pending.clear(body);
    } finally {
      setBusy(false);
    }
  }

  async function compare() {
    if (!previousRef || !loaded) return;
    setBusy(true);
    setError(null);
    try {
      setComparison(await compareVersions(ws, fileId, previousRef, loaded.ref));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const held = pending.current !== null;
  return (
    <div
      className="card stack-sm"
      aria-label={`File ${file.filename}`}
      style={FIT}
    >
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="small"
        style={WRAP}
        data-testid="file-editor-heading"
      >
        {file.filename}
      </h3>
      {file.office_provenance ? (
        <p className="small muted" data-testid="office-provenance" style={WRAP}>
          Editable office-v1 copy of an unchanged original (snapshot{" "}
          {file.office_provenance.source_snapshot_id}, original SHA-256{" "}
          {file.office_provenance.original_sha256}). Saving changes only this
          copy.
        </p>
      ) : null}
      {loaded === null && !error ? (
        <p className="small muted">Loading and verifying…</p>
      ) : null}
      {staleDraft !== null ? (
        <p className="hint">
          An unsaved draft from an older version of this file was found. It was
          not applied automatically.{" "}
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            style={BTN}
            onClick={() => {
              edit(staleDraft);
              setStaleDraft(null);
            }}
          >
            Load that draft anyway
          </button>
        </p>
      ) : null}
      {file.editable && (loaded || held) ? (
        <>
          <label className="field">
            <span className="field-label">
              Text ({utf8Length(text).toLocaleString()} bytes)
              {dirty ? " — unsaved edit" : ""}
              {loaded?.newline === "crlf"
                ? " · CRLF line endings are preserved on save"
                : ""}
              {loaded?.hasBom ? " · the file’s BOM is preserved on save" : ""}
            </span>
            <textarea
              value={text}
              onChange={(e) => edit(e.target.value)}
              rows={10}
              disabled={busy || held}
            />
          </label>
          {needsConsent ? (
            <label className="row small">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={busy}
              />
              <span>
                This file has {loaded!.newline === "cr" ? "CR" : "mixed"} line
                endings, which this editor cannot reproduce. Saving this edit
                normalizes every line ending to LF.
              </span>
            </label>
          ) : null}
          {held ? (
            <p className="hint">
              This save was sent but its outcome is unknown.
              {pending.restored ? " It was recovered after a reload." : ""}{" "}
              Retry replays the identical request; nothing is re-sent
              automatically and it is never recorded twice.
            </p>
          ) : null}
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={BTN}
              onClick={() => void save()}
              disabled={
                busy || (!held && (!dirty || (needsConsent && !consent)))
              }
            >
              {busy ? "Saving…" : held ? "Retry the same save" : "Save"}
            </button>
            {held ? (
              <button
                type="button"
                className="btn btn-sm btn-quiet"
                style={BTN}
                onClick={() => {
                  pending.set(null);
                  setUnknownOutcome(false);
                }}
                disabled={busy}
              >
                Abandon the unsent save (keeps the text)
              </button>
            ) : null}
          </div>
          {citations && citations.revisionId === savedVersion ? (
            <div
              className="stack-xs"
              data-testid="file-citations"
              data-revision={citations.revisionId}
              data-body-hash={citations.bodyHash}
            >
              {dirty ? (
                <p className="small muted">
                  Citations below describe the last saved version, not your
                  unsaved edit.
                </p>
              ) : null}
              <ArtifactCitations
                key={`${ws}:${citations.revisionId}:${citations.bodyHash}`}
                ws={ws}
                artifactId={citations.artifactId}
                revisionId={citations.revisionId}
                bodyHash={citations.bodyHash}
              />
            </div>
          ) : null}
        </>
      ) : null}
      {!file.editable && loaded ? (
        <pre
          className="small"
          style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
        >
          {loaded.display}
        </pre>
      ) : null}
      {previousRef && loaded ? (
        <details>
          <summary className="small">What changed in the last save</summary>
          {comparison === null ? (
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              style={BTN}
              onClick={() => void compare()}
              disabled={busy}
            >
              Compare the exact saved versions
            </button>
          ) : comparison.identical ? (
            <p className="small muted">The two versions are byte-identical.</p>
          ) : (
            <div className="stack-sm" style={FIT}>
              <pre
                className="small"
                style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
              >
                {comparison.diff}
              </pre>
              {comparison.omitted_diff_ranges.length > 0 ? (
                <p className="small muted">
                  The diff is truncated:{" "}
                  {comparison.diff_bytes.toLocaleString()} bytes in full, with{" "}
                  {comparison.omitted_diff_ranges.length} omitted range(s)
                  hashed server-side.
                </p>
              ) : null}
              {comparison.left_omitted_ranges.length > 0 ||
              comparison.right_omitted_ranges.length > 0 ? (
                <p className="small muted">
                  Only the first part of each version was diffed; the untouched
                  remainders are recorded as exact omitted ranges.
                </p>
              ) : null}
            </div>
          )}
        </details>
      ) : null}
      <FileExport
        ws={ws}
        file={file}
        saved={loaded?.ref ?? null}
        savedText={loaded?.display ?? null}
        dirty={dirty}
        workVersion={workVersion}
        openFile={openFile}
      />
      {error ? (
        <p className="hint" role="alert">
          {error}
          {unknownOutcome
            ? " The write may or may not have been recorded. Retry replays the exact same request; nothing is re-sent automatically."
            : null}
        </p>
      ) : null}
    </div>
  );
}
