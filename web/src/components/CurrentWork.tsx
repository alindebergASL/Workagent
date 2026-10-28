"use client";
import Link from "next/link";
import { useCurrentWorkspace } from "@/lib/client/workspace";
import type { WorkState } from "@/lib/client/work-state";
import { scopedHref } from "@/lib/scope";
import { formatTime } from "@/lib/time";
import {
  executionView,
  factLabel,
  hasWork,
  responsibilityView,
  reviewNote,
} from "@/lib/work-view";
import { ErrorNotice, StatusBadge } from "./ui";

/**
 * What is true for this conversation right now, from the work snapshot:
 * the current run, live responsibilities, saved work and changes waiting for
 * review. Earlier check-ins are labelled as earlier. Ids, phases and the
 * connection live behind Details.
 */
export function CurrentWork({
  work,
  ws,
  cid,
}: {
  work: WorkState;
  ws: string;
  cid: string;
}) {
  const { zone } = useCurrentWorkspace();
  if (work.revoked)
    return (
      <p className="notice-line" role="alert" data-testid="work-revoked">
        Your access to this conversation changed. What was shown before is
        hidden and new messages can’t be sent. Your unsent draft is kept on this
        device.
      </p>
    );
  const s = work.snapshot;
  if (!s) return work.error ? <ErrorNotice error={work.error} /> : null;
  const facts = work.attention?.facts ?? [];
  if (!hasWork(s) && !facts.length) return null;
  const exec = executionView(s.execution);
  const titles = new Map(s.artifacts.map((a) => [a.id, a.title]));
  const artifactHref = (id: string, anchor = "") =>
    scopedHref(`/conversations/${cid}/artifacts/${id}${anchor}`, ws);

  return (
    <section
      className="card card-quiet stack-sm current-work"
      aria-labelledby="current-work-title"
      data-testid="current-work"
      data-execution={s.execution.state}
      tabIndex={-1}
    >
      <div className="row wrap">
        <h2 id="current-work-title" className="section-title">
          Now
        </h2>
        {exec ? <StatusBadge label={exec.label} tone={exec.tone} /> : null}
        <span className="small muted" role="status" data-stream={work.status}>
          {work.stale || work.status === "reconnecting"
            ? `Can’t reach the service. Showing what was checked ${formatTime(s.checked_at, zone)}.`
            : `Checked ${formatTime(s.checked_at, zone)}`}
        </span>
      </div>

      {exec ? (
        <p
          className={exec.unresolved ? "notice-line" : "small"}
          role={exec.unresolved ? "alert" : undefined}
          data-testid="current-execution"
        >
          {exec.text}
          {s.execution.last_progress_at && !exec.unresolved
            ? ` Last progress recorded ${formatTime(s.execution.last_progress_at, zone)}.`
            : ""}
        </p>
      ) : null}

      {s.responsibility.length ? (
        <ul className="work-list" aria-label="Responsibilities">
          {s.responsibility.map((r) => {
            const v = responsibilityView(r);
            return (
              <li key={v.id} className="stack-xs" data-assignment={v.id}>
                <div className="row wrap">
                  <StatusBadge label={v.label} tone={v.tone} />
                  {v.reviewRequired ? (
                    <StatusBadge
                      label="Needs your review"
                      tone="status-attention"
                    />
                  ) : null}
                  <Link
                    className="link-quiet small"
                    href={scopedHref(`/assignments/${v.id}`, ws)}
                  >
                    Open
                  </Link>
                </div>
                <p className="small" data-testid="responsibility-next">
                  Next: {v.next}
                  {v.checkIn
                    ? ` · Checks back ${formatTime(v.checkIn, zone)}`
                    : ""}
                </p>
                {v.earlier ? (
                  <p
                    className="small muted clamp-2"
                    data-testid="responsibility-earlier"
                  >
                    Earlier check-in
                    {v.earlier.at
                      ? ` (${formatTime(v.earlier.at, zone)})`
                      : " (time not recorded)"}
                    : {v.earlier.text}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {s.pending_proposals.length ? (
        <ul className="work-list" aria-label="Changes waiting for review">
          {s.pending_proposals.map((p) => (
            <li key={p.proposal_id} data-proposal={p.proposal_id}>
              <Link
                className="small"
                href={artifactHref(p.artifact_id, `#proposal-${p.proposal_id}`)}
              >
                Proposed change to {titles.get(p.artifact_id) || "saved work"}
              </Link>{" "}
              <span className="small muted">{reviewNote(p)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {facts.length ? (
        <div className="row wrap" data-testid="attention">
          <span className="small">
            {facts.length === 1
              ? factLabel(facts[0]!)
              : `${facts.length} changes since you last looked`}
          </span>
          <button
            type="button"
            className="link-quiet small"
            onClick={() => void work.markSeen()}
            disabled={work.marking}
          >
            {work.marking ? "Marking…" : "Mark as seen"}
          </button>
          {work.seenError ? (
            <span className="small muted" role="status">
              Not marked yet; marking again is safe.
            </span>
          ) : null}
        </div>
      ) : null}

      <details className="ids-details">
        <summary>Details</summary>
        <dl className="ids small">
          {s.artifacts.map((a) => (
            <div key={a.id}>
              <dt>
                <Link href={artifactHref(a.id)}>{a.title || a.kind}</Link>
              </dt>
              <dd>Current version {a.current_revision_id}</dd>
            </div>
          ))}
          {s.execution.run_id ? (
            <div>
              <dt>Run</dt>
              <dd>
                {s.execution.run_id}
                {s.execution.phase ? ` · ${s.execution.phase}` : ""}
                {s.execution.reason ? ` · ${s.execution.reason}` : ""}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Worker</dt>
            <dd>
              {s.execution.admission === "admitted"
                ? "Admitted"
                : "Not admitted"}
              {" · "}
              {s.execution.worker_observed_at
                ? `${s.execution.worker_live ? "live" : "not live"}, last seen ${formatTime(s.execution.worker_observed_at, zone)}`
                : "not observed"}
            </dd>
          </div>
          {facts.length > 1 ? (
            <div>
              <dt>Changes</dt>
              <dd>
                {facts.map((f) => (
                  <span key={f.event_id} className="row">
                    {factLabel(f)} · {formatTime(f.occurred_at, zone)}
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Updates</dt>
            <dd>
              {work.status === "live"
                ? "Live"
                : work.status === "polling"
                  ? "Checking every few seconds"
                  : work.status === "reconnecting"
                    ? "Reconnecting"
                    : "Connecting"}{" "}
              · version {s.work_version}
            </dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
