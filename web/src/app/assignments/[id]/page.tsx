"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useResource } from "@/lib/client/hooks";
import { useWorkspace } from "@/lib/client/workspace";
import type { Assignment } from "@/lib/contract/types";
import { EXECUTION } from "@/lib/execution";
import { formatTime } from "@/lib/time";
import {
  checkLabel,
  completedSummary,
  currentRun,
  decisionArtifactId,
  phaseOf,
  provenanceOf,
  shortTitle,
  statusOf,
  waitingSummary,
} from "@/lib/work-state";
import { Ownership } from "@/components/Ownership";
import { SourcesDrawer } from "@/components/SourcesDrawer";
import { artifactStatus, ErrorNotice, StatusBadge } from "@/components/ui";

export default function AssignmentPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { workspace, zone } = useWorkspace();
  const wsId = workspace?.id ?? null;
  const res = useResource<Assignment>(
    wsId ? `assignment:${wsId}:${id}` : null,
    (signal) => api.getAssignment(wsId!, id, signal),
    {
      pollMs: 2500,
      // Read-only refresh only while work is actually moving; an unknown or
      // waiting outcome is re-read on focus or "Check again", never retried.
      shouldPoll: (a) => {
        if (!a) return true;
        const phase = phaseOf(a);
        if (phase === "unknown" || phase === "waiting") return false;
        return (
          a.state === "queued" ||
          a.state === "working" ||
          a.artifacts.some(
            (x) => x.state === "generating" || x.state === "queued",
          )
        );
      },
    },
  );
  const a = res.data;
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sourcesBtn = useRef<HTMLButtonElement>(null);
  const artifactTitles = useMemo(
    () => Object.fromEntries((a?.artifacts ?? []).map((x) => [x.id, x.title])),
    [a],
  );

  const back = (
    <Link className="back-link" href="/">
      ← Back to agent
    </Link>
  );

  if (res.error && !a) {
    return (
      <div className="agent-col">
        {back}
        <ErrorNotice
          error={res.error}
          actions={
            <Link className="btn btn-sm" href="/">
              Back to agent
            </Link>
          }
        />
      </div>
    );
  }
  if (!a) {
    return (
      <div className="agent-col" aria-busy="true">
        {back}
        <div className="skeleton" style={{ width: "30%" }} />
        <div className="skeleton" style={{ width: "60%", height: "2em" }} />
      </div>
    );
  }

  const phase = phaseOf(a);
  const badge = statusOf(a);
  const run = currentRun(a);
  const provenance = provenanceOf(run?.execution);
  // The document the recommendation was read from, else the plan.
  const plan =
    a.artifacts.find((x) => x.id === a.recommendation?.artifact_id) ??
    a.artifacts.find((x) => x.kind === "plan");
  const review = decisionArtifactId(a);
  const reviewTitle = review ? artifactTitles[review] : null;

  const statusLine: {
    tone: string;
    text: string;
    more?: { summary: string; text: string };
  } = (() => {
    switch (phase) {
      case "working":
        return {
          tone: "live",
          text: `I’m on it · ${a.stage ?? "Preparing"}. Saved results appear below as they’re ready.`,
        };
      case "decision":
        return {
          tone: "attn",
          text:
            run?.state === "decision_stale"
              ? `A proposal for your ${(reviewTitle ?? "saved work").toLowerCase()} is based on an older version. Your edits are kept.`
              : `A proposed change to your ${(reviewTitle ?? "saved work").toLowerCase()} needs your decision. Your saved version is unchanged.`,
        };
      case "unknown":
        return {
          tone: "live",
          text: "Waiting to confirm what happened. Nothing will be sent again; I’ll show the result once it’s confirmed.",
          more: {
            summary: "Why this is waiting",
            text: "A request to the agent may have gone out, but its result hasn’t been confirmed yet. Retrying could do the work twice, so this only checks for the recorded result.",
          },
        };
      case "waiting":
        return {
          tone: "live",
          text: waitingSummary(run),
          more: run?.reason
            ? {
                summary: "Details",
                text: [run.reason, run.next_action].filter(Boolean).join(" "),
              }
            : undefined,
        };
      case "unverified":
        return {
          tone: "attn",
          text: "This result couldn’t be verified against the saved document, so it isn’t shown as done.",
          more: run?.reason
            ? {
                summary: "Details",
                text: [run.reason, run.next_action].filter(Boolean).join(" "),
              }
            : undefined,
        };
      case "blocked":
        return {
          tone: "attn",
          text:
            a.unresolved[0] ??
            "This work can’t continue without you. Saved results are kept.",
        };
      case "stopped":
        return { tone: "done", text: "Stopped. Saved results are kept." };
      case "paused":
        return {
          tone: "done",
          text: "Paused. Nothing new is prepared until you resume. Saved results are kept.",
        };
      case "approved":
        return {
          tone: "done",
          text:
            run?.state === "readback_verified"
              ? "Revision approved and confirmed by reading it back. No external action was taken."
              : run?.state === "approved"
                ? "You approved a revision earlier; your current version has changed since. No external action was taken."
                : "Revision approved. No external action was taken.",
          more: {
            summary: "What approval covers",
            text: "Approving saves this document revision as your current version. It does not mark tasks or responsibility criteria complete, and it does not carry out the next action.",
          },
        };
      default:
        return {
          tone: "done",
          text: `${completedSummary(a)} Ready for you to review.`,
          more: {
            summary: "What review means",
            text: "Preparation is not approval, and the prepared next action hasn’t been carried out. Nothing becomes an approved revision until you apply it.",
          },
        };
    }
  })();

  return (
    <div className="agent-col">
      {back}
      <header className="agent-intro stack">
        <div className="agent-presence agent-presence-sm" aria-hidden="true" />
        <p className="eyebrow">
          Updated {formatTime(a.updated_at || a.observed_at, zone)}
          {res.reconnecting ? " · reconnecting…" : ""}
        </p>
        <h1>{shortTitle(a.title)}</h1>
        <div className="row">
          <StatusBadge label={badge.label} tone={badge.tone} />
        </div>
        <p className="status-line" data-tone={statusLine.tone} role="status">
          <span className="dot" aria-hidden="true" />
          <span>{statusLine.text}</span>
        </p>
        {phase === "unknown" ? (
          <div className="row">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void res.refresh()}
            >
              Check again
            </button>
          </div>
        ) : null}
        {statusLine.more ? (
          <details className="status-more">
            <summary>{statusLine.more.summary}</summary>
            <p className="small muted">{statusLine.more.text}</p>
          </details>
        ) : null}
      </header>

      {phase === "decision" && review ? (
        <section className="decision-card" aria-labelledby="next-title">
          <p className="eyebrow-caps">Your next decision</p>
          <h2 id="next-title">
            Keep your version, or apply the proposed change.
          </h2>
          {run?.question ? (
            <p className="decision-question">{run.question.prompt}</p>
          ) : null}
          <p>
            Nothing is applied until you decide. Both versions stay available.
          </p>
          <Link
            className="btn btn-on-soft"
            href={`/assignments/${a.id}/artifacts/${review}`}
          >
            Review the change
          </Link>
        </section>
      ) : null}

      {a.recommendation ? (
        <section className="result" aria-labelledby="result-title">
          <h2 id="result-title">Recommendation</h2>
          <p className="result-lead">{a.recommendation.summary}</p>
          {a.recommendation.judgment ? (
            <p className="decision-question">
              Where your judgment is needed: {a.recommendation.judgment}
            </p>
          ) : null}
          {a.recommendation.evidence.length ? (
            <ul className="evidence">
              {a.recommendation.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : null}
          {a.recommendation.uncertainty.length ? (
            <details className="disclosure">
              <summary>What this doesn’t tell you</summary>
              <ul className="disclosure-body evidence">
                {a.recommendation.uncertainty.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {plan && phase !== "decision" ? (
            <div className="row">
              <Link
                className="btn btn-primary"
                href={`/assignments/${a.id}/artifacts/${plan.id}`}
              >
                Open plan
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}

      <Ownership assignment={a} onChanged={res.refresh} />

      <section aria-labelledby="saved-title" className="stack">
        <h2 id="saved-title" className="section-title">
          Saved work
        </h2>
        {a.artifacts.length === 0 ? (
          <p className="muted">
            {phase === "working" || phase === "unknown" || phase === "waiting"
              ? "Nothing saved yet."
              : "No results were saved."}
          </p>
        ) : (
          <ul className="work-list">
            {a.artifacts.map((x) => {
              const s = artifactStatus(
                x.state,
                x.partial,
                Boolean(x.approved_revision_id),
              );
              return (
                <li key={x.id}>
                  <Link
                    className="work-row"
                    href={`/assignments/${a.id}/artifacts/${x.id}`}
                    data-phase={
                      x.state === "needs_review" ? "decision" : "completed"
                    }
                  >
                    <span className="work-row-main">
                      <span className="work-row-title">{x.title}</span>
                      <span className="work-row-status">
                        <StatusBadge label={s.label} tone={s.tone} />
                      </span>
                    </span>
                    <span className="work-row-go" aria-hidden="true">
                      ↗
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <details className="disclosure">
        <summary>What I checked</summary>
        <div className="disclosure-body stack-lg stack">
          <div className="stack">
            <h3>Your request</h3>
            <p className="small">{a.goal}</p>
            <p className="hint">
              {provenance
                ? `${provenance.label}.`
                : `Prepared by the ${EXECUTION.worker}, not a live agent run.`}{" "}
              Reference {a.id}.
            </p>
          </div>
          {run?.artifacts?.length && run.checks?.length ? (
            <div className="stack">
              <h3>Document checks</h3>
              <ul className="checks" aria-label="Document checks">
                {run.checks.map((c) => (
                  <li key={c.name} data-status={c.status}>
                    <span aria-hidden="true">
                      {c.status === "passed"
                        ? "✓"
                        : c.status === "failed"
                          ? "✕"
                          : "·"}
                    </span>
                    <span>
                      {checkLabel(c.name)}
                      {c.status === "passed"
                        ? ""
                        : c.status === "failed"
                          ? " · didn’t hold"
                          : " · not verified"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="hint">
                These check the saved document only. The next action itself
                hasn’t been carried out.
              </p>
            </div>
          ) : null}
          {run?.unresolved?.length ? (
            <div className="stack">
              <h3>Still open</h3>
              <ul className="evidence">
                {run.unresolved.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="stack">
            <h3>Done when</h3>
            <ul className="evidence">
              {a.completion_criteria.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
          <div className="stack">
            <div className="row row-between">
              <h3>Sources</h3>
              <button
                ref={sourcesBtn}
                type="button"
                className="btn btn-sm"
                onClick={() => setSourcesOpen(true)}
              >
                Open sources
              </button>
            </div>
            <div className="chips">
              {a.selected_source_refs.map((s) => (
                <span className="chip chip-static" key={s.id}>
                  <span>{s.title}</span>
                  <span className="ver">@{s.version}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </details>

      {a.activity.length ? (
        <details className="disclosure">
          <summary>What happened</summary>
          <ul className="disclosure-body activity">
            {[...a.activity].reverse().map((ev) => (
              <li key={ev.id}>
                <time dateTime={ev.at}>{formatTime(ev.at, zone)}</time>
                <span>{ev.message}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <SourcesDrawer
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        assignmentId={a.id}
        artifactTitles={artifactTitles}
        returnFocusTo={sourcesBtn}
      />
    </div>
  );
}
