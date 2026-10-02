"use client";
import Link from "next/link";
import { useWorkspace } from "@/lib/client/workspace";
import { useWorkOverview } from "@/lib/client/overview";
import {
  completedSummary,
  isCompleted,
  isWorking,
  phaseOf,
  shortTitle,
  workAttention,
  type WorkItem,
} from "@/lib/work-state";
import { Composer } from "@/components/Composer";
import { ErrorNotice } from "@/components/ui";
import { WorkRow } from "@/components/WorkRow";

function lede(items: WorkItem[]): string {
  const phases = items.map(phaseOf);
  if (phases.includes("decision"))
    return "One change is waiting for your decision. Or we can start something new.";
  if (phases.includes("blocked"))
    return "Something needs you before it can continue.";
  const working = items.find(isWorking);
  if (working)
    return "I’m preparing your work now. You can hand over something else meanwhile.";
  const done = items.find(isCompleted);
  if (done)
    return `${completedSummary(done)} Pick it up, or start something new.`;
  return "Hand over something you’d like finished. I’ll work from the records you choose.";
}

export default function AgentHome() {
  const { workspace, error: wsError } = useWorkspace();
  const wsId = workspace?.id ?? null;
  const overview = useWorkOverview(wsId);
  const items = overview.data ?? [];
  const attention = workAttention(items);
  const working = items.filter(isWorking);
  const completed = items.filter((i) => {
    const p = phaseOf(i);
    return p === "completed" || p === "stopped";
  });
  const newest = completed[0];

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
    <div className="agent-col">
      <p className="context-line">
        <span className="dot" aria-hidden="true" />
        Your agent · {workspace?.name ?? "Personal workspace"}
      </p>
      <section className="agent-intro" aria-labelledby="home-title">
        <div className="agent-presence" aria-hidden="true" />
        <h1 id="home-title">Good to see you.</h1>
        <p className="lede" aria-live="polite">
          {overview.loading && !overview.data
            ? "Checking on your work…"
            : lede(items)}
        </p>
      </section>

      {attention ? (
        <section className="decision-card" aria-labelledby="decision-title">
          <p className="eyebrow-caps">{attention.eyebrow}</p>
          <h2 id="decision-title">{attention.title}</h2>
          <p>{attention.body}</p>
          <p className="small muted clamp-2">
            {shortTitle(attention.item.summary.title)}
          </p>
          <Link className="btn btn-on-soft" href={attention.href}>
            {attention.action}
          </Link>
        </section>
      ) : null}

      <Composer wsId={wsId} />

      {overview.error && !overview.data ? (
        <ErrorNotice
          error={overview.error}
          actions={
            <button
              className="btn btn-sm"
              onClick={() => void overview.refresh()}
            >
              Try again
            </button>
          }
        />
      ) : null}

      {items.length || overview.reconnecting ? (
        <div className="since">
          {overview.reconnecting ? (
            <p className="hint" role="status">
              Reconnecting. Showing the work last observed.
            </p>
          ) : null}
          {completed.length ? (
            <details
              className="since-group"
              open={!attention && !working.length}
            >
              <summary>
                <span className="dot dot-done" aria-hidden="true" />
                Completed · {completed.length}
                {newest ? (
                  <span className="since-peek clamp-1">
                    {completedSummary(newest)}
                  </span>
                ) : null}
              </summary>
              <ul className="work-list">
                {completed.map((item) => (
                  <WorkRow key={item.summary.id} item={item} />
                ))}
              </ul>
            </details>
          ) : null}
          {working.length ? (
            <details className="since-group" open>
              <summary>
                <span className="dot dot-live" aria-hidden="true" />
                I’m handling · {working.length}
              </summary>
              <ul className="work-list">
                {working.map((item) => (
                  <WorkRow key={item.summary.id} item={item} />
                ))}
              </ul>
            </details>
          ) : null}
          {items.filter(
            (i) => phaseOf(i) === "decision" || phaseOf(i) === "blocked",
          ).length > (attention ? 1 : 0) ? (
            <details className="since-group">
              <summary>
                <span className="dot dot-attn" aria-hidden="true" />
                Also waiting on you
              </summary>
              <ul className="work-list">
                {items
                  .filter(
                    (i) =>
                      phaseOf(i) === "decision" || phaseOf(i) === "blocked",
                  )
                  .filter((i) => i !== attention?.item)
                  .map((item) => (
                    <WorkRow key={item.summary.id} item={item} />
                  ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
