"use client";
import Link from "next/link";
import { useWorkspace } from "@/lib/client/workspace";
import { useWorkOverview } from "@/lib/client/overview";
import type { AssignmentSummary } from "@/lib/contract/types";
import {
  isWorking,
  phaseOf,
  shortTitle,
  statusOf,
  workAttention,
} from "@/lib/work-state";
import { Composer } from "@/components/Composer";
import { ErrorNotice, StatusBadge } from "@/components/ui";
import { WorkRow } from "@/components/WorkRow";

function lede(items: AssignmentSummary[]): string {
  const phases = items.map(phaseOf);
  // The timely card below carries the exact action; the lede only orients.
  if (
    phases.includes("decision") ||
    phases.includes("blocked") ||
    phases.includes("prepared")
  )
    return "Here’s where your work stands. Or hand over something new.";
  if (items.some(isWorking))
    return "I’m preparing your work now. You can hand over something else meanwhile.";
  if (phases.includes("unknown") || phases.includes("waiting"))
    return "Some work is waiting on something outside your control. I’ll keep it as it is.";
  if (phases.includes("approved"))
    return "Your approved work is saved. What should we move forward next?";
  return "Hand over something you’d like finished. I’ll work from the records you choose.";
}

export default function AgentHome() {
  const { workspace, error: wsError } = useWorkspace();
  const wsId = workspace?.id ?? null;
  const overview = useWorkOverview(wsId);
  const items = overview.data ?? [];
  const attention = workAttention(items);
  const working = items.filter(isWorking);
  const rest = items.filter((i) => !isWorking(i) && i !== attention?.item);

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
        Your agent · Work continues here
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
        <section
          className="decision-card"
          aria-labelledby="decision-title"
          data-phase={phaseOf(attention.item)}
          data-assignment={attention.item.id}
        >
          <div className="row row-between">
            <p className="eyebrow-caps">{attention.eyebrow}</p>
            <StatusBadge {...statusOf(attention.item)} />
          </div>
          <h2 id="decision-title">{attention.title}</h2>
          <p className="small clamp-2">{shortTitle(attention.item.title)}</p>
          <p className="small muted">{attention.body}</p>
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
          {working.length ? (
            <details className="since-group" open>
              <summary>
                <span className="dot dot-live" aria-hidden="true" />
                I’m handling · {working.length}
              </summary>
              <ul className="work-list">
                {working.map((item) => (
                  <WorkRow key={item.id} item={item} />
                ))}
              </ul>
            </details>
          ) : null}
          {rest.length ? (
            <details
              className="since-group your-work"
              open={!attention && !working.length}
            >
              <summary>
                <span className="dot dot-done" aria-hidden="true" />
                Your work · {rest.length}
              </summary>
              <ul className="work-list">
                {rest.map((item) => (
                  <WorkRow key={item.id} item={item} />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
