"use client";
import Link from "next/link";
import { useWorkspace } from "@/lib/client/workspace";
import { useWorkOverview } from "@/lib/client/overview";
import {
  useConversationWork,
  type ConversationWork,
} from "@/lib/client/conversation-work";
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
import { ConversationWorkRow } from "@/components/ConversationWorkRow";

function lede(items: AssignmentSummary[], made: ConversationWork[]): string {
  const phases = items.map(phaseOf);
  // The timely card below carries the exact action; the lede only orients.
  if (
    made.some((w) => w.decision) ||
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
  if (made.length)
    return "Your work is saved below. Pick it up, or start something new.";
  return "Ask, think something through, or hand over something you’d like finished.";
}

/** Owned work I’m carrying, separate from what needs the person and what has settled. */
const HANDLING = new Set(["working", "waiting", "unknown", "paused"]);
/**
 * Approval saves a document revision and stopping ends work; neither is a
 * verified goal outcome, so nothing here is called "Done". A Done group waits
 * for an authoritative goal-completion record from the backend.
 */
const SETTLED = new Set(["approved", "stopped"]);

export default function AgentHome() {
  const { workspace, error: wsError, zone } = useWorkspace();
  const wsId = workspace?.id ?? null;
  const overview = useWorkOverview(wsId);
  const items = overview.data ?? [];
  const attention = workAttention(items);
  // Work conversations own, from their records; no assignment is invented.
  const conversationWork = useConversationWork(wsId);
  const made = conversationWork.data ?? [];
  const leadDecision = !attention && made[0]?.decision?.fresh ? made[0] : null;
  const madeDecisions = made.filter((w) => w.decision && w !== leadDecision);
  const madeSaved = made.filter((w) => !w.decision);
  const others = items.filter((i) => i !== attention?.item);
  // A recorded hand-over that can't start yet is never shown as being handled.
  const handling = others.filter(
    (i) => HANDLING.has(phaseOf(i)) && !isRecordedHandover(i),
  );
  const approved = others.filter((i) => phaseOf(i) === "approved");
  const stopped = others.filter((i) => phaseOf(i) === "stopped");
  const ready = others.filter(
    (i) =>
      (!HANDLING.has(phaseOf(i)) && !SETTLED.has(phaseOf(i))) ||
      isRecordedHandover(i),
  );
  const rows = (list: AssignmentSummary[]) =>
    list.map((item) => <WorkRow key={item.id} item={item} />);
  const madeRows = (list: ConversationWork[]) =>
    list.map((w) => (
      <ConversationWorkRow
        key={`${w.workspace_id}:${w.artifact_id}`}
        w={w}
        zone={zone}
      />
    ));
  const groups = [
    {
      key: "handling",
      label: "I’m handling",
      dot: "dot-live",
      rows: rows(handling),
    },
    {
      key: "ready",
      label: "Ready for you",
      dot: "dot-attn",
      rows: [...madeRows(madeDecisions), ...rows(ready)],
    },
    {
      key: "made",
      label: "Made in your conversations",
      dot: "dot-done",
      rows: madeRows(madeSaved),
    },
    {
      key: "approved",
      label: "Approved and saved",
      dot: "dot-done",
      rows: rows(approved),
    },
    { key: "stopped", label: "Stopped", dot: "", rows: rows(stopped) },
  ].filter((g) => g.rows.length);
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
            : lede(items, made)}
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
      ) : leadDecision ? (
        <section
          className="decision-card"
          aria-labelledby="decision-title"
          data-phase="decision"
          data-artifact={leadDecision.artifact_id}
        >
          <div className="row row-between">
            <p className="eyebrow-caps">Waiting for you</p>
            <StatusBadge label="Decision needed" tone="status-attention" />
          </div>
          <h2 id="decision-title">A proposed version is ready</h2>
          <p className="small clamp-2">{shortTitle(leadDecision.title)}</p>
          <p className="small muted">
            From “{leadDecision.conversation_title}”. Your saved version stays
            until you apply it.
          </p>
          <Link
            className="btn btn-on-soft"
            href={`/conversations/${leadDecision.conversation_id}/artifacts/${leadDecision.artifact_id}`}
          >
            Review the proposal
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
                {g.label} · {g.rows.length}
              </summary>
              <ul className="work-list">{g.rows}</ul>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}
