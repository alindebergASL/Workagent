"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, newCommandId } from "@/lib/client/api";
import { useResource } from "@/lib/client/hooks";
import { useWorkspace } from "@/lib/client/workspace";
import { ApiError } from "@/lib/contract/errors";
import type { SourceDetail } from "@/lib/contract/types";
import { EXECUTION } from "@/lib/execution";
import { ErrorNotice } from "./ui";

const SAMPLE_REQUEST =
  "Start with my own intake log and notes. Help me decide one change to test, produce a reusable review checklist and give me a private working plan. I should get value even if I collaborate with nobody this week.";
const SAMPLE_SOURCE_IDS = ["SG-F2", "SG-F3", "SG-F7"];
const COMPLETION =
  "Produce a private working plan and reusable checklist from the selected sources, preserving human notes and identifying evidence and uncertainty.";

/**
 * Hand work to the agent. Creating work is a durable command: one command ID
 * per attempt of the same content, so a retry after a transport failure
 * replays rather than duplicates. Text and source choices survive errors.
 */
export function Composer({
  wsId,
  contextLabel = "Your context",
  autoFocus = false,
}: {
  wsId: string | null;
  contextLabel?: string;
  autoFocus?: boolean;
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
  const commandId = useRef<string | null>(null);
  const requestRef = useRef<HTMLTextAreaElement>(null);
  const panelId = useId();

  const canStart =
    request.trim().length > 0 &&
    selected.length > 0 &&
    !submitting &&
    Boolean(wsId);

  const start = useCallback(async () => {
    if (!wsId || !canStart) {
      if (selected.length === 0) setContextOpen(true);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    if (!commandId.current) commandId.current = newCommandId();
    try {
      const refs = selected.map((id) => {
        const s = sources.data?.find((x) => x.id === id);
        return { id, version: s?.version ?? "1" };
      });
      const result = await api.createAssignment(wsId, {
        command_id: commandId.current,
        goal: request.trim(),
        selected_source_refs: refs,
        completion_criteria: [COMPLETION],
      });
      commandId.current = null;
      router.push(`/assignments/${result.assignment_id}`);
    } catch (e) {
      setSubmitError(e);
      if (!(e instanceof ApiError && e.isAmbiguousWrite))
        commandId.current = null;
      setSubmitting(false);
    }
  }, [wsId, canStart, selected, sources.data, request, router]);

  useEffect(() => {
    // Changing the request after a failed attempt starts a new command.
    commandId.current = null;
  }, [request, selected]);

  useEffect(() => {
    if (autoFocus) requestRef.current?.focus();
  }, [autoFocus]);

  const useSample = () => {
    setRequest(SAMPLE_REQUEST);
    setSelected(
      SAMPLE_SOURCE_IDS.filter((id) => sources.data?.some((s) => s.id === id)),
    );
    setContextOpen(true);
    requestRef.current?.focus();
  };

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const contextText = selected.length
    ? `${contextLabel} · ${selected.length} source${selected.length === 1 ? "" : "s"}`
    : contextLabel;

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
          disabled={submitting}
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
          >
            {contextText}
          </button>
          <span className="composer-spacer" />
          <button
            type="submit"
            className="btn btn-primary send"
            disabled={!request.trim() || submitting || wsLoading || !wsId}
          >
            {submitting ? "Starting…" : "Start work"}
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
                    disabled={submitting}
                  />
                  <span>{source.title}</span>
                  <span className="ver">@{source.version}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </form>
      {request.trim() && selected.length === 0 && !contextOpen ? (
        <p className="hint">
          Choose the records this work may use before starting.
        </p>
      ) : null}
      {submitError ? (
        <ErrorNotice
          error={submitError}
          actions={
            <button
              type="button"
              className="btn btn-sm"
              disabled={!canStart}
              onClick={() => void start()}
            >
              {submitError instanceof ApiError && submitError.isAmbiguousWrite
                ? "Retry the same request"
                : "Try again"}
            </button>
          }
        />
      ) : null}
      <div className="composer-after">
        <button
          type="button"
          className="link-quiet"
          onClick={useSample}
          disabled={!sources.data || submitting}
        >
          Try the intake example ↗
        </button>
        <span className="hint">
          {EXECUTION.short}: prepares an intake plan and checklist from the
          selected records. It is not a live agent run.
        </span>
      </div>
    </div>
  );
}
