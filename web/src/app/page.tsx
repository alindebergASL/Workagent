"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, newCommandId } from "@/lib/client/api";
import { useResource } from "@/lib/client/hooks";
import { useWorkspace } from "@/lib/client/workspace";
import { ApiError } from "@/lib/contract/errors";
import type { AssignmentSummary, SourceDetail } from "@/lib/contract/types";
import { formatTime } from "@/lib/time";
import {
  assignmentStatus,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/ui";

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
        completion_criteria: [],
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
  const needsReview = useMemo(
    () => list.filter((a) => a.needs_review_artifact_ids.length > 0),
    [list],
  );

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
    <>
      <section
        className={hasAssignments ? "stack-lg stack" : "hero-empty"}
        aria-labelledby="home-title"
      >
        <div className="stack">
          <div className="eyebrow">
            <span>{workspace?.name ?? "Personal workspace"}</span>
            <span aria-hidden="true">·</span>
            <span>{workspace?.scope_label ?? "Private"}</span>
          </div>
          <h1 id="home-title">What would you like to finish?</h1>
          {!hasAssignments ? (
            <p className="muted">
              Describe the work in your own words and choose the records it
              should use. Results and next steps appear here.
            </p>
          ) : null}
        </div>

        <form
          className="card card-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <div className="field request-field">
            <label htmlFor="request">Your request</label>
            <textarea
              id="request"
              ref={requestRef}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="Analyze my intake log and improve my working plan."
              disabled={submitting}
              required
            />
            {mode === "mock" ? (
              <div className="hint">
                Private pilot:{" "}
                <button
                  type="button"
                  className="btn btn-quiet btn-sm btn-wrap"
                  onClick={useSample}
                  disabled={!sources.data || submitting}
                >
                  Use the sample request and sources
                </button>{" "}
                (fixture records from the private pilot)
              </div>
            ) : null}
          </div>

          <fieldset
            className="field"
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <legend className="field-label">Sources</legend>
            <div className="hint">
              Only records you can already access. Work uses the version shown.
            </div>
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
              <div
                className="skeleton"
                style={{ width: "40%" }}
                aria-hidden="true"
              />
            ) : null}
            <div className="chips">
              {sources.data?.map((s) => (
                <label
                  className="chip"
                  key={s.id}
                  data-selected={selected.includes(s.id) ? "true" : "false"}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={() => toggle(s.id)}
                    disabled={submitting}
                  />
                  <span>{s.title}</span>
                  <span className="ver">@{s.version}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {submitError ? (
            <ErrorNotice
              error={submitError}
              actions={
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void start()}
                  disabled={!canStart}
                >
                  {submitError instanceof ApiError &&
                  submitError.isAmbiguousWrite
                    ? "Retry the same request"
                    : "Try again"}
                </button>
              }
            />
          ) : null}

          <div className="row row-between">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!canStart || wsLoading}
              aria-disabled={!canStart}
            >
              {submitting ? "Starting…" : "Start work"}
            </button>
            <span className="small muted">
              {selected.length
                ? `${selected.length} source${selected.length === 1 ? "" : "s"} selected`
                : "Choose at least one source"}
            </span>
          </div>
        </form>
      </section>

      <section className="stack-lg stack" aria-labelledby="assignments-title">
        <div className="row row-between">
          <h2 id="assignments-title">Your assignments</h2>
          {assignments.reconnecting ? (
            <span className="status status-attention">Reconnecting…</span>
          ) : null}
        </div>
        {needsReview.length ? (
          <Notice
            tone="notice-warn"
            title="Revision needs review"
            role="status"
          >
            {needsReview.map((a) => (
              <div key={a.id}>
                <Link
                  href={`/assignments/${a.id}/artifacts/${a.needs_review_artifact_ids[0]}`}
                >
                  {a.title}
                </Link>
                : a proposed change is waiting for your decision.
              </div>
            ))}
          </Notice>
        ) : null}
        {assignments.error && !assignments.data ? (
          <ErrorNotice
            error={assignments.error}
            actions={
              <button
                className="btn btn-sm"
                onClick={() => void assignments.refresh()}
              >
                Try again
              </button>
            }
          />
        ) : null}
        <div className="card card-quiet">
          {assignments.loading && !assignments.data ? (
            <div className="stack" aria-busy="true">
              <div className="skeleton" style={{ width: "55%" }} />
              <div className="skeleton" style={{ width: "35%" }} />
            </div>
          ) : !hasAssignments ? (
            <p className="muted">
              No assignments yet. Results and next steps will appear here.
            </p>
          ) : (
            <ul className="list">
              {list.map((a) => {
                const st = assignmentStatus(a.state, a.stage);
                return (
                  <li className="assignment-item" key={a.id}>
                    <div className="stack">
                      <Link href={`/assignments/${a.id}`}>
                        <h3>{a.title}</h3>
                      </Link>
                      <div className="meta">
                        <StatusBadge label={st.label} tone={st.tone} />
                        {a.needs_review_artifact_ids.length ? (
                          <StatusBadge
                            label="Revision needs review"
                            tone="status-attention"
                          />
                        ) : null}
                        <span>Updated {formatTime(a.updated_at, zone)}</span>
                      </div>
                      {a.latest_result ? (
                        <p className="small">{a.latest_result}</p>
                      ) : null}
                      {a.next_step ? (
                        <p className="small muted">Next: {a.next_step}</p>
                      ) : null}
                    </div>
                    <Link className="btn btn-sm" href={`/assignments/${a.id}`}>
                      Continue
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
