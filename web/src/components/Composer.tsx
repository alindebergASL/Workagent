"use client";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { API_MODE, api, newCommandId } from "@/lib/client/api";
import { CAPABILITIES } from "@/lib/client/capabilities";
import { useResource } from "@/lib/client/hooks";
import { useWorkspace } from "@/lib/client/workspace";
import { scopedHref } from "@/lib/scope";
import { ApiError, describeSendError } from "@/lib/contract/errors";
import type {
  CreateAssignmentCommand,
  SourceDetail,
} from "@/lib/contract/types";
import { conversationApi } from "@/lib/client/real-api";
import { shortTitle } from "@/lib/work-state";
import { FileName } from "@/components/AttachedFiles";
import {
  ATTACH_ACCEPT,
  attachmentsProblem,
  readAttachment,
  type MessageAttachment,
} from "@/lib/contract/natural";
import { ErrorNotice } from "./ui";
import { DocumentPicker } from "./Batch2Controls";
import {
  entryProblem,
  expectedDocumentsMissing,
  uploadAll,
} from "@/lib/client/documents";
import { useStagedDocuments } from "@/lib/client/staged-documents";
import { scopedSession } from "@/lib/client/session-scope";
import {
  afterHomeStartError,
  clearHomeChat,
  readHomeChat,
  runHomeStart,
  leaveHome,
  selectHome,
  settlesHere,
  type HomeSelection,
  saveHomeChat,
  type HomeChat,
} from "@/lib/client/home-start";
import type { DocumentRef } from "@/lib/contract/batch2";

const SAMPLE_REQUEST =
  "Start with my own intake log and notes. Help me decide one change to test, produce a reusable review checklist and give me a private working plan. I should get value even if I collaborate with nobody this week.";
const SAMPLE_SOURCE_IDS = ["SG-F2", "SG-F3", "SG-F7"];
/**
 * The deployed API needs at least one completion criterion. General work gets a
 * neutral one (never a fixed plan/checklist shape) until success conditions
 * become optional in the agreed delta.
 */
const GENERAL_COMPLETION =
  "Bring the result back for my review, with what it is based on and anything still uncertain.";

const DRAFT_KEY = "workagent:composer-draft";

/** Ways to begin, from the prototype; each only fills the message. */
const STARTERS = [
  { label: "Think something through", text: "Help me think through " },
  { label: "Take something off my plate", text: "Take this off my plate: " },
];

function readDraft(scope: string): string {
  try {
    return scopedSession.getItem(`${DRAFT_KEY}:${scope}`) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(scope: string, text: string): void {
  try {
    if (text) scopedSession.setItem(`${DRAFT_KEY}:${scope}`, text);
    else scopedSession.removeItem(`${DRAFT_KEY}:${scope}`);
  } catch {
    /* storage unavailable: the in-memory draft still exists */
  }
}

function readDraftFiles(scope: string): MessageAttachment[] {
  try {
    const raw = scopedSession.getItem(`${DRAFT_KEY}:${scope}:files`);
    return raw ? (JSON.parse(raw) as MessageAttachment[]) : [];
  } catch {
    return [];
  }
}
function writeDraftFiles(scope: string, files: MessageAttachment[]): void {
  try {
    if (files.length)
      scopedSession.setItem(
        `${DRAFT_KEY}:${scope}:files`,
        JSON.stringify(files),
      );
    else scopedSession.removeItem(`${DRAFT_KEY}:${scope}:files`);
  } catch {
    /* storage unavailable: the in-memory attachments still exist */
  }
}

/**
 * Talk to the agent, or hand something over. Context is optional to write;
 * "Take it from here" is the explicit delegation. Creating work is a durable
 * command: once an attempt's outcome is unknown (lost response) the exact
 * command and its Space are frozen and the inputs lock, so retrying replays it
 * and never creates a second piece of work. The text survives every error and
 * a reload of this tab.
 */
export function Composer({
  wsId,
  contextLabel = "Your context",
  destinations,
  onDestination,
  destinationNote,
}: {
  wsId: string | null;
  contextLabel?: string;
  /**
   * Where a new conversation can start, when there is a choice (Home). The
   * draft stays as it is when the destination changes; the choice is locked
   * while a request's outcome is still being settled.
   */
  destinations?: readonly { id: string; name: string }[];
  onDestination?: (id: string) => void;
  /** What the person should know about the chosen destination. */
  destinationNote?: ReactNode;
}) {
  const router = useRouter();
  const { loading: wsLoading } = useWorkspace();
  const sources = useResource<SourceDetail[]>(
    wsId ? `sources:${wsId}` : null,
    async (signal) => (await api.listSources(wsId!, signal)).items,
  );
  const draftScope = wsId ?? "none";
  const [request, setRequest] = useState("");
  // Files to send with the message (natural admission only). Kept with the
  // draft for this tab; the server assigns their reference and hash.
  const [files, setFiles] = useState<MessageAttachment[]>([]);
  const [fileError, setFileError] = useState("");
  const natural = CAPABILITIES.naturalAdmission;
  // PDF/DOCX/XLSX originals (B2.5): frozen local snapshots, in memory only.
  // They upload once into the conversation after it exists; the message then
  // carries only their confirmed refs.
  const documentsOn = API_MODE === "real";
  // Kept as exact binary snapshots on this device (IndexedDB) under Home's
  // draft, so a reload or an unknown upload restores them for the same
  // create-upload-send sequence.
  const staged = useStagedDocuments(wsId, "home", documentsOn);
  const { docs, ctl } = staged;
  const [pickError, setDocError] = useState("");
  const docError = pickError || staged.storeError;
  const [selected, setSelected] = useState<string[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const [needsContext, setNeedsContext] = useState(false);
  const [unsentNote, setUnsentNote] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const pending = useRef<{
    workspace: string;
    command: CreateAssignmentCommand;
  } | null>(null);
  // Starting a conversation is two commands (create, then send). Each is
  // frozen once its outcome is uncertain so a retry replays it exactly.
  const chat = useRef<HomeChat | null>(null);
  const [, rerender] = useState(0);
  // Unresolved commands are kept for this tab so a reload can only replay
  // them exactly (never a fresh command that could duplicate the work).
  // A conversation start is kept by `home-start` under the workspace it
  // began in (beyond this tab when it carries documents).
  const saveCommands = () => {
    if (!wsId) return;
    const key = `workagent:pending:${wsId}:home-assignment`;
    try {
      if (pending.current)
        scopedSession.setItem(key, JSON.stringify(pending.current));
      else scopedSession.removeItem(key);
    } catch {
      /* storage unavailable: the in-memory command still holds */
    }
  };
  // The live selection: every change of workspace is a new epoch, and a
  // start only settles into the selection it began in. Selected and left in
  // layout effects, so it changes with the commit (not later), and leaving
  // (a switch or unmount) invalidates it before any late completion lands.
  const live = useRef<HomeSelection>({ workspace: null, epoch: 0 });
  useLayoutEffect(() => {
    const read = <T,>(kind: string): T | null => {
      if (!wsId) return null;
      try {
        const raw = scopedSession.getItem(
          `workagent:pending:${wsId}:home-${kind}`,
        );
        return raw ? (JSON.parse(raw) as T) : null;
      } catch {
        return null;
      }
    };
    const next = selectHome(live.current, wsId, {
      chat: wsId ? readHomeChat(wsId) : null,
      assignment: read<NonNullable<typeof pending.current>>("assignment"),
    });
    live.current = next.selection;
    chat.current = next.chat;
    pending.current = next.assignment;
    if (next.chat) {
      setRequest(next.chat.text);
      if (next.chat.send?.attachments) setFiles(next.chat.send.attachments);
    } else if (next.assignment) setRequest(next.assignment.command.goal);
    rerender((n) => n + 1);
    return () => {
      live.current = leaveHome(live.current);
    };
  }, [wsId]);
  const requestRef = useRef<HTMLTextAreaElement>(null);
  const panelId = useId();
  const chatUncertain = Boolean(chat.current?.uncertain);
  const locked = submitting || Boolean(pending.current) || chatUncertain;

  // Restore this tab's unsent text once the Space is known.
  useEffect(() => {
    if (!wsId) return;
    const saved = readDraft(wsId);
    if (saved) setRequest((current) => current || saved);
    const savedFiles = readDraftFiles(wsId);
    if (savedFiles.length)
      setFiles((current) => (current.length ? current : savedFiles));
  }, [wsId]);
  useEffect(() => {
    if (wsId) writeDraft(draftScope, request);
  }, [wsId, draftScope, request]);
  useEffect(() => {
    if (wsId) writeDraftFiles(draftScope, files);
  }, [wsId, draftScope, files]);
  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    try {
      const read = await Promise.all([...list].map(readAttachment));
      const next = [...files, ...read];
      const problem = attachmentsProblem(next);
      if (problem) throw new Error(problem);
      setFiles(next);
      setFileError("");
    } catch (e) {
      setFileError(
        e instanceof Error ? e.message : "That file can’t be attached.",
      );
    }
  };

  // The request field grows with its text so a long request stays readable.
  useLayoutEffect(() => {
    const el = requestRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 72)}px`;
  }, [request]);

  const hasText = request.trim().length > 0;

  // Without chosen context, handing over only records a paused hand-over in
  // a new conversation; with context it starts work on an assignment.
  // A hand-over has no document field: it would drop them, so it waits.
  const docsBlockHandover = (docs.length > 0 && !chat.current) || !staged.ready;
  // A ref or upload identity belongs to the conversation this start created.
  const docDest = chat.current?.conversation
    ? {
        workspace_id: chat.current.workspace,
        conversation_id: chat.current.conversation.id,
      }
    : null;
  const docProblems = docs.map((e) => entryProblem(e, docDest));
  const docsReady = staged.ready && docProblems.every((p) => !p);
  // A pending start whose documents went missing: attaching the same files
  // again is its recovery, so the picker opens for exactly that.
  const missingExpected =
    Boolean(chat.current && !chat.current.send) &&
    staged.ready &&
    expectedDocumentsMissing(chat.current?.documents ?? [], docs);
  const pausedOnly =
    !pending.current && selected.length === 0 && CAPABILITIES.conversation;
  const delegate = async () => {
    if (!wsId || submitting) return;
    setUnsentNote(false);
    if (docsBlockHandover) return;
    // An uncertain conversation start is retried exactly as it was sent.
    if (chat.current) {
      void startConversation(chat.current.handover);
      return;
    }
    if (!pending.current && !hasText) {
      requestRef.current?.focus();
      return;
    }
    if (
      !pending.current &&
      selected.length === 0 &&
      CAPABILITIES.conversation
    ) {
      void startConversation(true);
      return;
    }
    if (
      !pending.current &&
      selected.length === 0 &&
      !CAPABILITIES.delegateWithoutContext
    ) {
      setNeedsContext(true);
      setContextOpen(true);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (pending.current && pending.current.workspace !== wsId)
        throw new ApiError({
          code: "transport",
          status: 0,
          message: "Return to the original Space to reconcile this request.",
        });
      if (!pending.current) {
        const refs = selected.map((id) => {
          const source = sources.data?.find((x) => x.id === id);
          if (!source)
            throw new ApiError({
              code: "source_changed",
              status: 409,
              message: "Refresh your context before handing this over.",
            });
          return { id, version: source.version };
        });
        pending.current = {
          workspace: wsId,
          command: {
            command_id: newCommandId(),
            goal: request.trim(),
            selected_source_refs: refs,
            completion_criteria: [GENERAL_COMPLETION],
          },
        };
      }
      saveCommands();
      const into = pending.current.workspace;
      const result = await api.createAssignment(into, pending.current.command);
      pending.current = null;
      saveCommands();
      writeDraft(draftScope, "");
      router.push(scopedHref(`/assignments/${result.assignment_id}`, into));
    } catch (e) {
      setSubmitError(e);
      // Only an ambiguous outcome keeps the frozen command; anything definite starts fresh.
      if (!(e instanceof ApiError && e.isAmbiguousWrite))
        pending.current = null;
      saveCommands();
      setSubmitting(false);
      rerender((n) => n + 1);
    }
  };

  /**
   * Talk without handing anything over. Creates the conversation, sends the
   * message, then opens it. With `handover`, the conversation opens on the
   * explicit hand-over step instead. The text is kept until the server has
   * admitted the message.
   */
  const startConversation = async (handover: boolean) => {
    if (!wsId || submitting) return;
    if (!chat.current && !hasText) return;
    if (!CAPABILITIES.conversation) {
      setUnsentNote(true);
      return;
    }
    setUnsentNote(false);
    setSubmitting(true);
    setSubmitError(null);
    // Every document write of this start lands in the draft it began from.
    const origin = ctl.origin();
    const began = live.current;
    let start: HomeChat | null = null;
    try {
      if (!chat.current) {
        if (!docsReady)
          throw new Error(
            "Attached documents need attention before this can be sent.",
          );
        // The message is the person's exact text; trim only shapes the title.
        chat.current = {
          workspace: wsId,
          text: request,
          create: {
            command_id: newCommandId(),
            title: shortTitle(request.trim(), 120),
            context_ids: selected.flatMap((id) => {
              const s = sources.data?.find((x) => x.id === id);
              return s ? [{ id, version: s.version }] : [];
            }),
          },
          conversation: null,
          send: null,
          documents: docs.map((d) => ({
            filename: d.doc.filename,
            sha256: d.doc.sha256,
          })),
          handover,
          uncertain: false,
        };
      }
      const c = chat.current;
      if (c.workspace !== wsId)
        throw new ApiError({
          code: "transport",
          status: 0,
          message: "Return to the original Space to reconcile this message.",
        });
      start = c;
      // Captured now: a later switch of Space never redirects these writes.
      const save = (x: HomeChat) => saveHomeChat(c.workspace, x);
      const { conversationId } = await runHomeStart(c, {
        save,
        create: conversationApi.create,
        send: conversationApi.send,
        // Originals upload once into the conversation, each as its own exact
        // command, from the device copies kept for Home. If those are gone,
        // nothing is sent without them.
        prepareSend: async (c) => {
          if (!staged.ready)
            throw new Error(
              "Attached documents aren’t ready yet. Recover them before sending.",
            );
          const expected = c.documents ?? [];
          if (expectedDocumentsMissing(expected, docs))
            throw new Error(
              `The document${expected.length === 1 ? "" : "s"} this message was started with (${expected.map((e) => e.filename).join(", ")}) ${expected.length === 1 ? "isn’t" : "aren’t"} attached any more. Attach the same file${expected.length === 1 ? "" : "s"} again to finish; nothing has been sent yet.`,
            );
          let document_refs: DocumentRef[] = [];
          if (docs.length) {
            if (!origin)
              throw new Error("Attached documents aren’t available.");
            document_refs = await uploadAll(
              {
                workspace_id: c.workspace,
                conversation_id: c.conversation!.id,
              },
              docs,
              (next) => ctl.persist(origin, next),
            );
          }
          // A fresh send (first, or after a definite refusal) carries what the
          // person can see now; only an unconfirmed send replays frozen text.
          c.text = request.trim() ? request : c.text;
          return {
            command_id: newCommandId(),
            expected_work_version: c.conversation!.work_version,
            text: c.text,
            ...(natural ? { attachments: files, target: null } : {}),
            ...(document_refs.length ? { document_refs } : {}),
          };
        },
      });
      // Origin-only cleanup: this start's record and its sent generations.
      clearHomeChat(c.workspace, c.create.command_id);
      if (origin && c.send?.document_refs?.length)
        void ctl.forgetRefs(origin, c.send.document_refs);
      writeDraft(c.workspace, "");
      writeDraftFiles(c.workspace, []);
      // Only the start still shown moves the page on.
      if (!settlesHere(live.current, began, chat.current, c)) return;
      chat.current = null;
      setFiles([]);
      router.push(
        scopedHref(
          `/conversations/${conversationId}${c.handover ? "?handover=1" : ""}`,
          c.workspace,
        ),
      );
    } catch (e) {
      const c = start;
      if (!c) {
        setSubmitError(e);
        return;
      }
      const next = afterHomeStartError(c, e);
      if (next) {
        if (next.conversation && !next.send && !next.uncertain)
          try {
            // A refused send: a new one uses the conversation's version now.
            const now = await conversationApi.get(
              next.workspace,
              next.conversation.id,
            );
            next.conversation.work_version = now.conversation.work_version;
            next.conversation.activation = now.conversation.model_activation;
          } catch {
            /* the next attempt re-reads it */
          }
        saveHomeChat(next.workspace, next);
      } else clearHomeChat(c.workspace, c.create.command_id);
      if (!settlesHere(live.current, began, chat.current, c)) return;
      chat.current = next;
      setSubmitError(e);
    } finally {
      setSubmitting(false);
      rerender((n) => n + 1);
    }
  };
  const send = () => {
    if ((!hasText && !chat.current) || (locked && !chatUncertain)) return;
    void startConversation(false);
  };

  useEffect(() => {
    if (!contextOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contextOpen]);

  const useSample = () => {
    setRequest(SAMPLE_REQUEST);
    setSelected(
      SAMPLE_SOURCE_IDS.filter((id) => sources.data?.some((s) => s.id === id)),
    );
    setNeedsContext(false);
    setUnsentNote(false);
    requestRef.current?.focus();
  };

  /** A starter only begins the sentence; nothing is sent until the person sends it. */
  const start = (text: string) => {
    setRequest(text);
    setUnsentNote(false);
    window.setTimeout(() => {
      const el = requestRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    }, 0);
  };

  const toggle = (id: string) => {
    setNeedsContext(false);
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const contextText = selected.length
    ? `${contextLabel} · ${selected.length} source${selected.length === 1 ? "" : "s"}`
    : contextLabel;
  const ambiguous = (Boolean(pending.current) || chatUncertain) && !submitting;
  const sendRefused =
    Boolean(chat.current?.conversation) &&
    submitError instanceof ApiError &&
    !submitError.isAmbiguousWrite;
  const unanswerable =
    sendRefused &&
    submitError instanceof ApiError &&
    submitError.code === "unsupported_operation";

  return (
    <div className="composer-wrap">
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label className="sr-only" htmlFor="request">
          Message your agent
        </label>
        <textarea
          id="request"
          ref={requestRef}
          value={request}
          onChange={(event) => {
            setRequest(event.target.value);
            setUnsentNote(false);
          }}
          placeholder="Ask, think aloud, or hand something over…"
          disabled={locked}
          rows={3}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              send();
            }
          }}
        />
        {docsBlockHandover ? (
          <p className="small muted" data-testid="handover-docs-note">
            A hand-over can’t carry documents yet. Send this as a message to
            include them, or remove them to hand it over; they stay attached
            until you choose.
          </p>
        ) : null}
        {documentsOn ? (
          <DocumentPicker
            docs={docs}
            error={docError}
            locked={
              submitting ||
              Boolean(pending.current) ||
              !staged.ready ||
              // Once a start is under way its documents are frozen with it,
              // except to attach the same files again when they went missing.
              (Boolean(chat.current) && !missingExpected)
            }
            onAdd={(list) => {
              if (!list?.length) return;
              // Bound to the draft it was picked in (not the one shown later).
              void ctl.add([...list]).then(setDocError);
            }}
            onRemove={(i) => {
              const gone = docs[i];
              const o = ctl.origin();
              if (gone && o) void ctl.forget(o, [gone.generation]);
            }}
            problems={docProblems}
            onReattach={(i) => {
              const gone = docs[i];
              const o = ctl.origin();
              if (gone && o && !submitting && !chat.current?.send)
                void ctl.reattach(o, gone.generation).catch(() => {});
            }}
            recovery={staged.recovery}
          />
        ) : null}
        {natural && (files.length || fileError) ? (
          <div className="composer-files">
            {files.map((f, i) => (
              <span className="file-chip" key={`${f.filename}:${i}`}>
                <FileName name={f.filename} />
                <button
                  type="button"
                  className="link-quiet small"
                  aria-label={`Remove ${f.filename}`}
                  disabled={locked}
                  onClick={() =>
                    setFiles((list) => list.filter((_, n) => n !== i))
                  }
                >
                  Remove
                </button>
              </span>
            ))}
            {fileError ? (
              <p role="alert" className="small">
                {fileError}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="composer-bar">
          {natural ? (
            <label
              className="chip-toggle file-pick icon-pick"
              data-disabled={locked}
              title="Attach a file"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.6-8.6a3.7 3.7 0 015.2 5.2l-8.6 8.6a1.8 1.8 0 01-2.6-2.6l8-8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="sr-only">Attach a file</span>
              <input
                type="file"
                className="sr-only"
                accept={ATTACH_ACCEPT}
                multiple
                disabled={locked || files.length >= 2}
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          ) : null}
          {/* Choosing records only matters when there are some. */}
          {sources.data?.length || selected.length || needsContext ? (
            <button
              type="button"
              className="chip-toggle"
              aria-expanded={contextOpen}
              aria-controls={panelId}
              data-filled={selected.length ? "true" : "false"}
              onClick={() => setContextOpen((v) => !v)}
              disabled={locked}
            >
              {contextText}
            </button>
          ) : null}
          <span className="composer-spacer" />
          <button
            type="button"
            className="btn btn-sm delegate"
            title={
              pausedOnly
                ? "Records it as a paused hand-over; nothing runs for this record. To have Workagent work on something, ask it in a conversation."
                : undefined
            }
            onClick={() => void delegate()}
            disabled={
              (!hasText && !pending.current) ||
              submitting ||
              wsLoading ||
              !wsId ||
              docsBlockHandover
            }
          >
            {submitting
              ? "Handing over…"
              : ambiguous
                ? "Retry same request"
                : pausedOnly
                  ? "Record a hand-over"
                  : "Take it from here"}
          </button>
          <button
            type="submit"
            className="send-round"
            aria-label="Send"
            title="Send"
            disabled={
              !hasText ||
              locked ||
              wsLoading ||
              !wsId ||
              !staged.ready ||
              (!chat.current && !docsReady)
            }
          >
            <span aria-hidden="true">↑</span>
          </button>
        </div>
        {destinations && destinations.length > 1 && onDestination ? (
          <div className="composer-destination small">
            <label>
              <span className="muted">Starts in </span>
              <select
                value={wsId ?? ""}
                onChange={(e) => {
                  // Records chosen as context belong to the old workspace.
                  setSelected([]);
                  onDestination(e.target.value);
                }}
                disabled={locked || Boolean(chat.current) || submitting}
                data-testid="home-destination"
              >
                {destinations.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {destinationNote}
        <div id={panelId} className="context-panel" hidden={!contextOpen}>
          <fieldset
            className="field"
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <legend className="field-label">Records this work may use</legend>
            <p className="hint" role={needsContext ? "status" : undefined}>
              {needsContext
                ? "To hand this over, choose at least one record. Handing over without context isn’t available yet."
                : "Optional. Only records you can access now; work uses the version shown."}
            </p>
            {sources.error ? (
              <ErrorNotice
                error={sources.error}
                actions={
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void sources.refresh()}
                  >
                    Try again
                  </button>
                }
              />
            ) : null}
            {sources.loading && !sources.data ? (
              <p role="status">Loading your context…</p>
            ) : null}
            <div className="chips">
              {sources.data?.map((source) => (
                <label
                  className="chip"
                  key={source.id}
                  data-selected={
                    selected.includes(source.id) ? "true" : "false"
                  }
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(source.id)}
                    onChange={() => toggle(source.id)}
                    disabled={locked}
                  />
                  <span>{source.title}</span>
                  <span className="ver">@{source.version}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="row">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setContextOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      </form>
      {unsentNote ? (
        <div className="agent-say agent-note" role="status">
          <div
            className="agent-presence agent-presence-xs"
            aria-hidden="true"
          />
          <div className="stack-sm">
            <p>
              I can’t reply in conversation yet: it isn’t connected in this
              build. Nothing was sent, and your message is still here.
            </p>
            <p className="hint">
              To have me work on it, choose <strong>Take it from here</strong>.
            </p>
          </div>
        </div>
      ) : null}
      {submitError ? (
        <ErrorNotice
          error={submitError}
          // A refused first message in a conversation that now exists: the
          // service won't answer there, and resending won't change that.
          describe={
            sendRefused
              ? (e) =>
                  describeSendError(e, chat.current?.conversation?.activation)
              : undefined
          }
          actions={
            ambiguous || unanswerable ? undefined : (
              <button
                type="button"
                className="btn btn-sm"
                disabled={submitting}
                onClick={() => void delegate()}
              >
                Try again
              </button>
            )
          }
        />
      ) : null}
      {ambiguous ? (
        <p className="hint" role="status">
          Your request is held exactly as sent. Retrying replays it, so it can’t
          create a second piece of work.
        </p>
      ) : null}
      <div className="composer-after">
        {STARTERS.map((st) => (
          <button
            key={st.label}
            type="button"
            className="link-quiet starter"
            onClick={() => start(st.text)}
            disabled={locked}
          >
            {st.label} ↗
          </button>
        ))}
        {API_MODE !== "real" && sources.data?.length ? (
          <button
            type="button"
            className="link-quiet starter-quiet"
            onClick={useSample}
            disabled={locked}
          >
            Try the intake example ↗
          </button>
        ) : null}
      </div>
    </div>
  );
}
