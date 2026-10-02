"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useResource } from "@/lib/client/hooks";
import { useWorkspace } from "@/lib/client/workspace";
import type { Assignment } from "@/lib/contract/types";
import { formatTime } from "@/lib/time";
import { SourcesDrawer } from "@/components/SourcesDrawer";
import {
  artifactStatus,
  assignmentStatus,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/ui";

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
      shouldPoll: (a) =>
        !a ||
        a.state === "queued" ||
        a.state === "working" ||
        a.artifacts.some(
          (x) => x.state === "generating" || x.state === "queued",
        ),
    },
  );
  const a = res.data;
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sourcesBtn = useRef<HTMLButtonElement>(null);
  const artifactTitles = useMemo(
    () => Object.fromEntries((a?.artifacts ?? []).map((x) => [x.id, x.title])),
    [a],
  );

  if (res.error && !a) {
    return (
      <>
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href="/">Work Home</Link>
        </nav>
        <ErrorNotice
          error={res.error}
          actions={
            <Link className="btn btn-sm" href="/">
              Work Home
            </Link>
          }
        />
      </>
    );
  }
  if (!a) {
    return (
      <div className="stack" aria-busy="true">
        <div className="skeleton" style={{ width: "30%" }} />
        <div className="skeleton" style={{ width: "60%", height: "2em" }} />
      </div>
    );
  }

  const st = assignmentStatus(a.state, a.stage);
  const plan = a.artifacts.find((x) => x.kind === "plan");
  const working = a.state === "queued" || a.state === "working";
  const primary = plan ? (
    <Link
      className="btn btn-primary"
      href={`/assignments/${a.id}/artifacts/${plan.id}`}
    >
      Open plan
    </Link>
  ) : a.state === "needs_input" ? (
    <button className="btn btn-primary" type="button">
      Respond
    </button>
  ) : null;

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Work Home</Link>
        <span aria-hidden="true">/</span>
        <span>{a.title}</span>
      </nav>

      <header className="stack">
        <div className="eyebrow">
          <span>{workspace?.scope_label ?? "Private"}</span>
          <span aria-hidden="true">·</span>
          <span>{a.id}</span>
          <span aria-hidden="true">·</span>
          <span>
            Last observed {formatTime(res.observedAt ?? a.observed_at, zone)}
          </span>
          {res.reconnecting ? (
            <StatusBadge label="Reconnecting…" tone="status-attention" />
          ) : null}
        </div>
        <h1>{a.title}</h1>
        <div className="row">
          <StatusBadge label={st.label} tone={st.tone} />
          {a.next_step ? (
            <span className="small muted">Next: {a.next_step}</span>
          ) : null}
        </div>
      </header>

      {a.needs_review_artifact_ids.length ? (
        <Notice tone="notice-warn" title="Revision needs review" role="status">
          {a.needs_review_artifact_ids.map((aid) => (
            <div key={aid}>
              <Link href={`/assignments/${a.id}/artifacts/${aid}`}>
                {artifactTitles[aid] ?? aid}
              </Link>
              : a proposed change is waiting for your decision. Your saved
              version is unchanged.
            </div>
          ))}
        </Notice>
      ) : null}

      {a.state === "failed" ? (
        <Notice
          tone="notice-error"
          title="This work didn’t finish"
          role="alert"
        >
          {a.unresolved.length
            ? a.unresolved.join(" ")
            : "Existing results are kept."}
        </Notice>
      ) : null}

      <div className="two-col">
        <div className="card-stack">
          <section className="card card-stack" aria-labelledby="result-title">
            <h2 id="result-title">
              {a.recommendation
                ? "Recommendation"
                : working
                  ? "Working on it"
                  : "Result"}
            </h2>
            {a.recommendation ? (
              <>
                <p style={{ fontSize: "1.0625rem" }}>
                  {a.recommendation.summary}
                </p>
                {a.recommendation.evidence.length ? (
                  <ul
                    className="stack small"
                    style={{ margin: 0, paddingLeft: "1.2em" }}
                  >
                    {a.recommendation.evidence.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                ) : null}
                {a.recommendation.uncertainty.length ? (
                  <details className="disclosure">
                    <summary>What this doesn’t tell you</summary>
                    <ul
                      className="disclosure-body small stack"
                      style={{ paddingLeft: "1.2em" }}
                    >
                      {a.recommendation.uncertainty.map((u, i) => (
                        <li key={i}>{u}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            ) : working ? (
              <p className="muted">
                {a.stage ? `${a.stage}.` : "Waiting to start."} Saved results
                appear below as they are ready; nothing is shown before it
                exists.
              </p>
            ) : (
              <p className="muted">No result was produced.</p>
            )}
            <div className="row">{primary}</div>
          </section>

          <section
            className="card card-stack"
            aria-labelledby="artifacts-title"
          >
            <h2 id="artifacts-title">Saved results</h2>
            {a.artifacts.length === 0 ? (
              <p className="muted">
                {working ? "Nothing saved yet." : "No results were saved."}
              </p>
            ) : (
              <div className="artifact-links">
                {a.artifacts.map((x) => {
                  const s = artifactStatus(
                    x.state,
                    x.partial,
                    Boolean(x.approved_revision_id),
                  );
                  return (
                    <Link
                      className="artifact-link"
                      href={`/assignments/${a.id}/artifacts/${x.id}`}
                      key={x.id}
                    >
                      <strong>{x.title}</strong>
                      <span className="meta">
                        <StatusBadge label={s.label} tone={s.tone} />
                        {x.accepted_revision_id ? (
                          <span>{x.accepted_revision_id}</span>
                        ) : null}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
            {working && a.artifacts.length ? (
              <p className="small muted">
                More results are still being drafted.
              </p>
            ) : null}
          </section>

          <details className="disclosure card card-quiet" open={false}>
            <summary>Activity</summary>
            <div className="disclosure-body">
              <ul className="activity">
                {[...a.activity].reverse().map((ev) => (
                  <li key={ev.id}>
                    <time dateTime={ev.at}>{formatTime(ev.at, zone)}</time>
                    <span>{ev.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </div>

        <aside className="card-stack">
          <section
            className="card card-quiet card-stack"
            aria-labelledby="goal-title"
          >
            <h2 id="goal-title">Goal</h2>
            <p className="small">{a.goal}</p>
            <h3>Done when</h3>
            <ul
              className="small stack"
              style={{ margin: 0, paddingLeft: "1.2em" }}
            >
              {a.completion_criteria.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </section>
          <section
            className="card card-quiet card-stack"
            aria-labelledby="sources-title"
          >
            <div className="row row-between">
              <h2 id="sources-title">Sources</h2>
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
          </section>
        </aside>
      </div>

      <SourcesDrawer
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        assignmentId={a.id}
        artifactTitles={artifactTitles}
        returnFocusTo={sourcesBtn}
      />
    </>
  );
}
