"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, newCommandId } from "@/lib/client/api";
import { useResource } from "@/lib/client/hooks";
import { useWorkspace } from "@/lib/client/workspace";
import { ApiError } from "@/lib/contract/errors";
import type { AssignmentSummary, SourceDetail } from "@/lib/contract/types";
import { workAttention } from "@/lib/work-state";
import { formatTime } from "@/lib/time";
import { assignmentStatus, ErrorNotice, StatusBadge } from "@/components/ui";

const SAMPLE_REQUEST =
  "Start with my own intake log and notes. Help me decide one change to test, produce a reusable review checklist and give me a private working plan. I should get value even if I collaborate with nobody this week.";
const SAMPLE_SOURCE_IDS = ["SG-F2", "SG-F3", "SG-F7"];

export default function WorkHome() {
  const {
    workspace,
    loading: wsLoading,
    error: wsError,
    zone,
    mode,
  } = useWorkspace();
  const router = useRouter();
  const wsId = workspace?.id ?? null;

  const sources = useResource<SourceDetail[]>(
    wsId ? `sources:${wsId}` : null,
    async (signal) => (await api.listSources(wsId!, signal)).items,
  );
  const assignments = useResource<AssignmentSummary[]>(
    wsId ? `assignments:${wsId}` : null,
    async (signal) => (await api.listAssignments(wsId!, signal)).items,
    {
      pollMs: 3000,
      shouldPoll: (list) =>
        Boolean(
          list?.some((a) => a.state === "queued" || a.state === "working"),
        ),
    },
  );

  const [request, setRequest] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const commandId = useRef<string | null>(null);
  const requestRef = useRef<HTMLTextAreaElement>(null);

  const canStart =
    request.trim().length > 0 &&
    selected.length > 0 &&
    !submitting &&
    Boolean(wsId);

  const start = useCallback(async () => {
    if (!wsId || !canStart) return;
    setSubmitting(true);
    setSubmitError(null);
    // One command ID per attempt of the same content: a retry after a transport
    // failure replays the same command rather than creating a second assignment.
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
        completion_criteria: [
          "Produce a private working plan and reusable checklist from the selected sources, preserving human notes and identifying evidence and uncertainty.",
        ],
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
    // Editing the request after a failed attempt starts a new command.
    commandId.current = null;
  }, [request, selected]);

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

  const list = assignments.data ?? [];
  const hasAssignments = list.length > 0;
  const attention = workAttention(list);

  if (wsError) {
    return (
      <ErrorNotice
        error={wsError}
        actions={
          <button className="btn" onClick={() => location.reload()}>
            Reload
          </button>
        }
      />
    );
  }

  return (
    <div className="agent-home">
      <section className="stack-lg stack" aria-labelledby="home-title">
        <div className="agent-presence" aria-hidden="true" />
        <div className="stack">
          <div className="eyebrow">
            {workspace?.name ?? "Your workspace"} ·{" "}
            {workspace?.scope_label ?? "Private"}
          </div>
          <h1 id="home-title">What would you like to move forward?</h1>
          <p className="muted">
            Bring the work here. Continue something underway, or hand over a new
            request.
          </p>
        </div>
        {attention ? (
          <section className="agent-initiative" aria-live="polite">
            <h2>{attention.title}</h2>
            <p>
              {attention.assignment.latest_result || attention.assignment.title}
            </p>
            {attention.assignment.next_step ? (
              <p className="small muted">{attention.assignment.next_step}</p>
            ) : null}
            <Link className="btn" href={attention.href}>
              {attention.action}
            </Link>
          </section>
        ) : null}
        <form
          className="agent-composer stack"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <label className="field-label" htmlFor="request">
            Tell me what you need
          </label>
          <textarea
            id="request"
            ref={requestRef}
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            placeholder="What would you like help carrying forward?"
            disabled={submitting}
            required
          />
          <details className="agent-context">
            <summary>
              Context ·{" "}
              {selected.length
                ? `${selected.length} sources selected`
                : "Choose sources"}
            </summary>
            <fieldset
              className="field"
              style={{ border: 0, padding: 0, marginTop: 16 }}
            >
              <legend className="field-label">Records this work may use</legend>
              {sources.error ? (
                <ErrorNotice
                  error={sources.error}
                  actions={
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void sources.refresh()}
                    >
                      Try again
                    </button>
                  }
                />
              ) : null}
              {sources.loading ? (
                <p role="status">Loading permitted sources…</p>
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
                  </label>
                ))}
              </div>
            </fieldset>
          </details>
          {submitError ? (
            <ErrorNotice
              error={submitError}
              actions={
                <button
                  type="button"
                  className="btn"
                  disabled={!canStart}
                  onClick={() => void start()}
                >
                  Retry the same request
                </button>
              }
            />
          ) : null}
          <div className="row row-between">
            <button
              type="button"
              className="btn btn-quiet"
              onClick={useSample}
              disabled={!sources.data || submitting}
            >
              Try the intake example
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!canStart || wsLoading}
            >
              {submitting ? "Starting…" : "Start work"}
            </button>
          </div>
          <p className="hint">
            {mode === "mock" ? "Mock service" : "Connected local service"} ·
            This build prepares an intake plan and checklist using deterministic
            sample data. General-purpose live agent execution is not connected
            yet.
          </p>
        </form>
      </section>
      <details className="agent-handling" open={undefined}>
        <summary>
          I’m handling ·{" "}
          {
            list.filter(
              (item) => item.state === "queued" || item.state === "working",
            ).length
          }{" "}
          in progress
        </summary>
        {assignments.reconnecting ? (
          <p role="status">Reconnecting. Last observed work is shown.</p>
        ) : null}
        {assignments.error ? <ErrorNotice error={assignments.error} /> : null}
        {assignments.loading && !assignments.data ? (
          <p role="status">Loading your work…</p>
        ) : null}
        {!hasAssignments && !assignments.loading ? (
          <p className="muted">Your delegated work will appear here.</p>
        ) : null}
        <ul className="list">
          {list.map((item) => {
            const status = assignmentStatus(item.state, item.stage);
            return (
              <li className="assignment-item" key={item.id}>
                <div className="stack">
                  <Link href={`/assignments/${item.id}`}>
                    <h3>{item.title}</h3>
                  </Link>
                  <div className="meta">
                    <StatusBadge label={status.label} tone={status.tone} />
                    <span>Updated {formatTime(item.updated_at, zone)}</span>
                  </div>
                  {item.latest_result ? (
                    <p className="small">{item.latest_result}</p>
                  ) : null}
                  {item.next_step ? (
                    <p className="small muted">{item.next_step}</p>
                  ) : null}
                </div>
                <Link className="btn btn-sm" href={`/assignments/${item.id}`}>
                  Open work
                </Link>
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
