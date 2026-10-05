"use client";
import Link from "next/link";
import { useWorkspace } from "@/lib/client/workspace";
import { useWorkOverview } from "@/lib/client/overview";
import type { AssignmentSummary } from "@/lib/contract/types";
import {
  isRecordedHandover,
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
  if (items.some((i) => phaseOf(i) === "paused" && !isRecordedHandover(i)))
    return "Some work is paused. Resume it whenever you’re ready, or start something new.";
  if (items.some(isRecordedHandover))
    return "You’ve handed over work I can’t start on my own yet. It’s recorded and waiting.";
  return "Ask, think something through, or hand over something you’d like finished.";
}

/** Owned work I’m carrying, separate from what is ready for the person and what is done. */
const HANDLING = new Set(["working", "waiting", "unknown", "paused"]);
const DONE = new Set(["approved", "stopped"]);

export default function AgentHome() {
  const { workspace, error: wsError } = useWorkspace();
  const wsId = workspace?.id ?? null;
  const overview = useWorkOverview(wsId);
  const items = overview.data ?? [];
  const attention = workAttention(items);
  const others = items.filter((i) => i !== attention?.item);
  // A recorded hand-over that can't start yet is never shown as being handled.
  const handling = others.filter(
    (i) => HANDLING.has(phaseOf(i)) && !isRecordedHandover(i),
  );
  const done = others.filter((i) => DONE.has(phaseOf(i)));
  const ready = others.filter(
    (i) =>
      (!HANDLING.has(phaseOf(i)) && !DONE.has(phaseOf(i))) ||
      isRecordedHandover(i),
  );
  const groups = [
    {
      key: "handling",
      label: "I’m handling",
      dot: "dot-live",
      items: handling,
    },
    { key: "ready", label: "Ready for you", dot: "dot-attn", items: ready },
    { key: "done", label: "Done", dot: "dot-done", items: done },
  ].filter((g) => g.items.length);
  // Open the most useful group first: what I'm carrying, else what's ready.
  const openKey = groups[0]?.key;

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

      {groups.length || overview.reconnecting ? (
        <div className="since">
          {overview.reconnecting ? (
            <p className="hint" role="status">
              Reconnecting. Showing the work last observed.
            </p>
          ) : null}
          {groups.map((g) => (
            <details
              key={g.key}
              className={`since-group since-${g.key}`}
              open={g.key === openKey && (!attention || g.key === "handling")}
            >
              <summary>
                <span className={`dot ${g.dot}`} aria-hidden="true" />
                {g.label} · {g.items.length}
              </summary>
              <ul className="work-list">
                {g.items.map((item) => (
                  <WorkRow key={item.id} item={item} />
                ))}
              </ul>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}
