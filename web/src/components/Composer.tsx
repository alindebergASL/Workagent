"use client";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, newCommandId } from "@/lib/client/api";
import { useResource } from "@/lib/client/hooks";
import { useWorkspace } from "@/lib/client/workspace";
import { ApiError } from "@/lib/contract/errors";
import type {
  CreateAssignmentCommand,
  SourceDetail,
} from "@/lib/contract/types";
import { ErrorNotice } from "./ui";

const SAMPLE_REQUEST =
  "Start with my own intake log and notes. Help me decide one change to test, produce a reusable review checklist and give me a private working plan. I should get value even if I collaborate with nobody this week.";
const SAMPLE_SOURCE_IDS = ["SG-F2", "SG-F3", "SG-F7"];
const COMPLETION =
  "Produce a private working plan and reusable checklist from the selected sources, preserving human notes and identifying evidence and uncertainty.";

/**
 * Hand work to the agent. Creating work is a durable command. Once an attempt's
 * outcome is unknown (lost response), the exact command and its Space are
 * frozen and the inputs lock: retrying replays that command, never a new one.
 * Text and source choices survive every error.
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
  const [request, setRequest] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const pending = useRef<{
    workspace: string;
    command: CreateAssignmentCommand;
  } | null>(null);
  const [, rerender] = useState(0);
  const requestRef = useRef<HTMLTextAreaElement>(null);
  const panelId = useId();
  const locked = submitting || Boolean(pending.current);

  // The request field grows with its text so a long request stays readable.
  useLayoutEffect(() => {
    const el = requestRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 72)}px`;
  }, [request]);

  const canStart =
    (request.trim().length > 0 &&
      selected.length > 0 &&
      !submitting &&
      Boolean(wsId)) ||
    (Boolean(pending.current) && !submitting);

  const start = useCallback(async () => {
    if (!wsId) return;
    if (!pending.current && selected.length === 0) {
      setContextOpen(true);
      return;
    }
    if (!canStart) return;
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
              message: "Refresh the selected sources before delegating.",
            });
          return { id, version: source.version };
        });
        pending.current = {
          workspace: wsId,
          command: {
            command_id: newCommandId(),
            goal: request.trim(),
            selected_source_refs: refs,
            completion_criteria: [COMPLETION],
          },
        };
      }
      const result = await api.createAssignment(
        pending.current.workspace,
        pending.current.command,
      );
      pending.current = null;
      router.push(`/assignments/${result.assignment_id}`);
    } catch (e) {
      setSubmitError(e);
      // Only an ambiguous outcome keeps the frozen command; anything definite starts fresh.
      if (!(e instanceof ApiError && e.isAmbiguousWrite))
        pending.current = null;
      setSubmitting(false);
      rerender((n) => n + 1);
    }
  }, [wsId, canStart, selected, sources.data, request, router]);

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
    requestRef.current?.focus();
  };

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const contextText = selected.length
    ? `${contextLabel} · ${selected.length} source${selected.length === 1 ? "" : "s"}`
    : contextLabel;
  const ambiguous = Boolean(pending.current) && !submitting;

  return (
    <div className="composer-wrap">
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <label className="sr-only" htmlFor="request">
          Message your agent
        </label>
        <textarea
          id="request"
          ref={requestRef}
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder="Ask, think aloud, or hand something over…"
          disabled={locked}
          rows={3}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void start();
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
            type="submit"
            className="btn btn-primary send"
            disabled={
              (!request.trim() && !pending.current) ||
              submitting ||
              wsLoading ||
              !wsId
            }
          >
            {submitting
              ? "Starting…"
              : ambiguous
                ? "Retry same request"
                : "Start work"}
            <span aria-hidden="true" className="send-arrow">
              ↑
            </span>
          </button>
        </div>
        <div id={panelId} className="context-panel" hidden={!contextOpen}>
          <fieldset
            className="field"
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <legend className="field-label">Records this work may use</legend>
            <p className="hint">
              Only records you can access now. Work uses the version shown.
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
              <p role="status">Loading your sources…</p>
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
      {request.trim() &&
      selected.length === 0 &&
      !contextOpen &&
      !pending.current ? (
        <p className="hint">
          Choose the records this work may use before starting.
        </p>
      ) : null}
      {submitError ? (
        <ErrorNotice
          error={submitError}
          actions={
            ambiguous ? undefined : (
              <button
                type="button"
                className="btn btn-sm"
                disabled={!canStart}
                onClick={() => void start()}
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
          Try the intake example
        </button>
      </div>
    </div>
  );
}
