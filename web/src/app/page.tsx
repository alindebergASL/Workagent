"use client";
import Link from "next/link";
import { scopedHref } from "@/lib/scope";
import { useWorkspace } from "@/lib/client/workspace";
import { useHomeOverview } from "@/lib/client/overview";
import {
  useHomeWork,
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
import { useHoldsIn } from "@/lib/client/responsibility";
import { holdGroup } from "@/lib/hold-view";
import { ConversationWorkRow } from "@/components/ConversationWorkRow";
import { useSinceMarker } from "@/lib/client/since-marker";
import {
  homeSummary,
  recentWork,
  sinceYouLeft,
  type SinceEntry,
} from "@/lib/since-you-left";
import { readableTitle } from "@/lib/titles";
import { formatTime } from "@/lib/time";

function lede(
  items: AssignmentSummary[],
  made: ConversationWork[],
  holding = 0,
): string {
  // A conversation's coarse assignment cannot establish current ownership
  // or execution. Let the canonical, freshness-labelled rows make those claims.
  if (items.some((i) => i.conversation_id))
    return "Here’s where your work stands.";
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
  if (holding)
    return "Some responsibilities are recorded as mine to carry. Nothing runs for them on its own yet.";
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

const SHOWN = 4;

/** The handful of things that changed, newest first, each one step away. */
function SinceYouLeft({
  entries,
  zone,
  onSeen,
}: {
  entries: SinceEntry[];
  zone: string;
  onSeen: () => void;
}) {
  const more = entries.length - SHOWN;
  return (
    <section
      className="since-left"
      aria-labelledby="since-left-title"
      data-testid="since-you-left"
    >
      <div className="row row-between">
        <h2 id="since-left-title" className="eyebrow-caps">
          Since you left
        </h2>
        <button type="button" className="btn btn-sm btn-quiet" onClick={onSeen}>
          Got it
        </button>
      </div>
      <ul>
        {entries.slice(0, SHOWN).map(({ work: w, what, at }) => (
          <li key={`${w.artifact_id}:${what}`} data-artifact={w.artifact_id}>
            <Link
              href={scopedHref(
                `/conversations/${w.conversation_id}/artifacts/${w.artifact_id}`,
                w.workspace_id,
              )}
            >
              {what === "proposed"
                ? `A proposed version of “${readableTitle(w.title)}” is waiting for you`
                : `Workagent saved a new version of “${readableTitle(w.title)}”`}
            </Link>
            <span className="small muted"> · {formatTime(at, zone)}</span>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <p className="small muted">
          {more === 1 ? "1 more change" : `${more} more changes`} in your work
          below.
        </p>
      ) : null}
    </section>
  );
}

export default function AgentHome() {
  const { workspace, workspaces, error: wsError, zone } = useWorkspace();
  const wsId = workspace?.id ?? null;
  // Handed-over work in every workspace this person can open.
  const workspaceIds = workspaces.map((w) => w.id);
  const overview = useHomeOverview(workspaceIds);
  const items = overview.data?.items ?? [];
  const attention = workAttention(items);
  // Work conversations own, from their records (no assignment is
  // invented), in every workspace this person can open: Home is one agent's
  // view. Each item opens in its own workspace.
  const conversationWork = useHomeWork(workspaceIds);
  const made = conversationWork.data?.items ?? [];
  const leadDecision = !attention && made[0]?.decision?.fresh ? made[0] : null;
  const madeDecisions = made.filter((w) => w.decision && w !== leadDecision);
  const madeSaved = made.filter((w) => !w.decision);
  // What changed since this device last showed Home; the decision already
  // shown in full below isn't repeated.
  const marker = useSinceMarker(
    workspaces.length ? "home" : null,
    conversationWork.data?.items ?? null,
  );
  const changed =
    marker.since === undefined || !conversationWork.data
      ? []
      : sinceYouLeft(made, marker.since).filter((e) => e.work !== leadDecision);
  // Where conversation hand-overs stand now: their current responsibility
  // records decide their group, never the assignment's coarse "paused".
  // Each is read in its own workspace.
  const { holds } = useHoldsIn(
    items
      .filter((i) => i.conversation_id)
      .map((i) => ({ ws: i.workspace_id, id: i.id })),
  );
  const groupOf = (i: AssignmentSummary) => holdGroup(holds[i.id]);
  const others = items.filter((i) => i !== attention?.item);
  const holding = others.filter((i) => groupOf(i) === "holding");
  const legacy = others.filter((i) => groupOf(i) === null);
  // A recorded hand-over that can't start yet is never shown as being handled.
  // What Workagent is actually doing: admitted responsibilities queued or
  // running, and older work still in progress.
  const handling = [
    ...others.filter((i) => groupOf(i) === "handling"),
    ...legacy.filter((i) => HANDLING.has(phaseOf(i)) && !isRecordedHandover(i)),
  ];
  const approved = legacy.filter((i) => phaseOf(i) === "approved");
  const stopped = [
    ...legacy.filter((i) => phaseOf(i) === "stopped"),
    ...others.filter((i) => groupOf(i) === "closed"),
  ];
  const ready = [
    ...others.filter((i) => groupOf(i) === "attention"),
    ...legacy.filter(
      (i) =>
        (!HANDLING.has(phaseOf(i)) && !SETTLED.has(phaseOf(i))) ||
        isRecordedHandover(i),
    ),
  ];
  const rows = (list: AssignmentSummary[]) =>
    list.map((item) => (
      <WorkRow key={item.id} item={item} hold={holds[item.id]} />
    ));
  const madeRows = (list: ConversationWork[]) =>
    list.map((w) => (
      <ConversationWorkRow
        key={`${w.workspace_id}:${w.artifact_id}`}
        w={w}
        zone={zone}
      />
    ));
  // One line that orients: what needs the person, what changed. Counted
  // from current records only (fresh proposals, the decision shown, read
  // responsibilities that need them), never from a coarse assignment state.
  const summary = homeSummary({
    needs:
      (attention ? 1 : 0) +
      made.filter((w) => w.decision?.fresh).length +
      others.filter((i) => groupOf(i) === "attention").length,
    savedSince: changed.filter((e) => e.what === "saved").length,
  });
  const recent = recentWork(made);
  // Spaces whose work couldn't be read just now, by either read.
  const unreadable = Math.max(
    overview.data?.unreadable ?? 0,
    conversationWork.data?.unreadable ?? 0,
  );
  const groups = [
    {
      key: "handling",
      label: "I’m handling",
      dot: "dot-live",
      rows: rows(handling),
    },
    {
      key: "ready",
      label: "Needs you",
      dot: "dot-attn",
      rows: [...madeRows(madeDecisions), ...rows(ready)],
    },
    {
      // Recorded as Workagent's to carry. Held isn't running: each row says
      // whether anything runs for it.
      key: "holding",
      label: "Responsibilities I’m holding",
      dot: "",
      rows: rows(holding),
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
  const primary = groups.some((g) => g.key === "ready" || g.key === "handling");

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
            : (summary ?? lede(items, made, holding.length))}
        </p>
      </section>

      <Composer wsId={wsId} />

      {/* Each feed says its own state: the work conversations made is read
          separately from handed-over work, and either can fail alone. */}
      {conversationWork.error && !conversationWork.data ? (
        <div data-testid="home-work-error">
          <ErrorNotice
            error={conversationWork.error}
            describe={() => ({
              title: "Work from your conversations couldn’t be read",
              nextAction:
                "It isn’t shown here, including any proposal waiting for you. Nothing was changed.",
            })}
            actions={
              <button
                className="btn btn-sm"
                onClick={() => void conversationWork.refresh()}
              >
                Try again
              </button>
            }
          />
        </div>
      ) : conversationWork.reconnecting ? (
        <p className="hint" role="status" data-testid="home-work-stale">
          Couldn’t re-check work from your conversations. It’s shown as last
          read, so a proposal may have changed since.
        </p>
      ) : null}

      {changed.length ? (
        <SinceYouLeft entries={changed} zone={zone} onSeen={marker.seenAll} />
      ) : null}

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
          {/* Named by the work, as people think of it; what's waiting
              says so in a line. */}
          <h2 id="decision-title" className="clamp-2">
            {shortTitle(leadDecision.title)}
          </h2>
          <p className="small">
            A proposed version is ready. Your saved version stays until you
            apply it.
          </p>
          <p className="small muted">
            From “{leadDecision.conversation_title}”
          </p>
          <Link
            className="btn btn-on-soft"
            href={scopedHref(
              `/conversations/${leadDecision.conversation_id}/artifacts/${leadDecision.artifact_id}`,
              leadDecision.workspace_id,
            )}
          >
            Review the proposal
          </Link>
        </section>
      ) : null}

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

      {groups.length || overview.reconnecting || unreadable ? (
        <div className="since">
          {overview.reconnecting ? (
            <p className="hint" role="status">
              Reconnecting. Showing the work last observed.
            </p>
          ) : null}
          {unreadable ? (
            <p className="hint" role="status" data-testid="home-unreadable">
              {unreadable === 1
                ? "Work in one of your spaces couldn’t be read just now, so it isn’t shown here."
                : `Work in ${unreadable} of your spaces couldn’t be read just now, so it isn’t shown here.`}
            </p>
          ) : null}
          {groups.map((g) => (
            <details
              key={g.key}
              className={`since-group since-${g.key}`}
              // What needs the person and what Workagent is handling read
              // open, as sections; the rest is a step away, unless it's all
              // there is.
              open={
                g.key === "ready" ||
                g.key === "handling" ||
                (!primary && g === groups[0])
              }
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

      {recent.length ? (
        <section
          className="pick-up"
          aria-labelledby="pick-up-title"
          data-testid="pick-up"
        >
          <h2 id="pick-up-title" className="eyebrow-caps">
            Pick up where you left off
          </h2>
          <ul>
            {recent.map((w) => (
              <li key={`${w.workspace_id}:${w.artifact_id}`}>
                <Link
                  href={scopedHref(
                    `/conversations/${w.conversation_id}/artifacts/${w.artifact_id}`,
                    w.workspace_id,
                  )}
                  data-artifact={w.artifact_id}
                >
                  <span className="clamp-2">{readableTitle(w.title)}</span>
                  <span aria-hidden="true">↗</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
