"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { api, newCommandId } from "@/lib/client/api";
import { CAPABILITIES } from "@/lib/client/capabilities";
import { useResource } from "@/lib/client/hooks";
import { useWorkspace } from "@/lib/client/workspace";
import { ApiError } from "@/lib/contract/errors";
import type {
  CreateAssignmentCommand,
  SourceDetail,
} from "@/lib/contract/types";
import { conversationApi } from "@/lib/client/real-api";
import { shortTitle } from "@/lib/work-state";
import { ErrorNotice } from "./ui";

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

function readDraft(scope: string): string {
  try {
    return sessionStorage.getItem(`${DRAFT_KEY}:${scope}`) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(scope: string, text: string): void {
  try {
    if (text) sessionStorage.setItem(`${DRAFT_KEY}:${scope}`, text);
    else sessionStorage.removeItem(`${DRAFT_KEY}:${scope}`);
  } catch {
    /* storage unavailable: the in-memory draft still exists */
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
}: {
  wsId: string | null;
  contextLabel?: string;
}) {
  const router = useRouter();
  const { loading: wsLoading } = useWorkspace();
  const sources = useResource<SourceDetail[]>(
    wsId ? `sources:${wsId}` : null,
    async (signal) => (await api.listSources(wsId!, signal)).items,
  );
  const draftScope = wsId ?? "none";
  const [request, setRequest] = useState("");
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
  const chat = useRef<{
    workspace: string;
    text: string;
    create: {
      command_id: string;
      title: string;
      context_ids: { id: string; version: string }[];
    };
    conversation: { id: string; work_version: number } | null;
    send: {
      command_id: string;
      expected_work_version: number;
      text: string;
    } | null;
    handover: boolean;
    uncertain: boolean;
  } | null>(null);
  const [, rerender] = useState(0);
  const requestRef = useRef<HTMLTextAreaElement>(null);
  const panelId = useId();
  const chatUncertain = Boolean(chat.current?.uncertain);
  const locked = submitting || Boolean(pending.current) || chatUncertain;

  // Restore this tab's unsent text once the Space is known.
  useEffect(() => {
    if (!wsId) return;
    const saved = readDraft(wsId);
    if (saved) setRequest((current) => current || saved);
  }, [wsId]);
  useEffect(() => {
    if (wsId) writeDraft(draftScope, request);
  }, [wsId, draftScope, request]);

  // The request field grows with its text so a long request stays readable.
  useLayoutEffect(() => {
    const el = requestRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 72)}px`;
  }, [request]);

  const hasText = request.trim().length > 0;

  const delegate = async () => {
    if (!wsId || submitting) return;
    setUnsentNote(false);
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
      const result = await api.createAssignment(
        pending.current.workspace,
        pending.current.command,
      );
      pending.current = null;
      writeDraft(draftScope, "");
      router.push(`/assignments/${result.assignment_id}`);
    } catch (e) {
      setSubmitError(e);
      // Only an ambiguous outcome keeps the frozen command; anything definite starts fresh.
      if (!(e instanceof ApiError && e.isAmbiguousWrite))
        pending.current = null;
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
    try {
      if (!chat.current) {
        const text = request.trim();
        chat.current = {
          workspace: wsId,
          text,
          create: {
            command_id: newCommandId(),
            title: shortTitle(text, 120),
            context_ids: selected.flatMap((id) => {
              const s = sources.data?.find((x) => x.id === id);
              return s ? [{ id, version: s.version }] : [];
            }),
          },
          conversation: null,
          send: null,
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
      if (!c.conversation) {
        const created = await conversationApi.create(c.workspace, c.create);
        c.conversation = { id: created.id, work_version: created.work_version };
      }
      if (!c.send)
        c.send = {
          command_id: newCommandId(),
          expected_work_version: c.conversation.work_version,
          text: c.text,
        };
      await conversationApi.send(c.workspace, c.conversation.id, c.send);
      const id = c.conversation.id;
      const goHandover = c.handover;
      chat.current = null;
      writeDraft(draftScope, "");
      router.push(`/conversations/${id}${goHandover ? "?handover=1" : ""}`);
    } catch (e) {
      setSubmitError(e);
      const c = chat.current;
      if (c) {
        if (e instanceof ApiError && e.isAmbiguousWrite) c.uncertain = true;
        else if (!c.conversation) chat.current = null;
        else {
          // The conversation exists; a definite refusal of the message keeps
          // it and lets a new send use its current version.
          c.send = null;
          c.uncertain = false;
          try {
            const now = await conversationApi.get(
              c.workspace,
              c.conversation.id,
            );
            c.conversation.work_version = now.conversation.work_version;
          } catch {
            /* the next attempt re-reads it */
          }
        }
      }
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
        <div className="composer-bar">
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
          <span className="composer-spacer" />
          <button
            type="button"
            className="btn btn-sm delegate"
            onClick={() => void delegate()}
            disabled={
              (!hasText && !pending.current) || submitting || wsLoading || !wsId
            }
          >
            {submitting
              ? "Handing over…"
              : ambiguous
                ? "Retry same request"
                : "Take it from here"}
          </button>
          <button
            type="submit"
            className="send-round"
            aria-label="Send"
            title="Send"
            disabled={!hasText || locked || wsLoading || !wsId}
          >
            <span aria-hidden="true">↑</span>
          </button>
        </div>
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
          actions={
            ambiguous ? undefined : (
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
        <button
          type="button"
          className="link-quiet"
          onClick={useSample}
          disabled={!sources.data?.length || locked}
        >
          Try the intake example ↗
        </button>
      </div>
    </div>
  );
}
