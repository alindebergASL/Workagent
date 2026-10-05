"use client";
import Link from "next/link";
import { activityFrom, dayLabel } from "@/lib/activity";
import { CAPABILITIES } from "@/lib/client/capabilities";
import { useResource } from "@/lib/client/hooks";
import { useWorkOverview } from "@/lib/client/overview";
import { conversationApi } from "@/lib/client/real-api";
import { useWorkspace } from "@/lib/client/workspace";
import type { ConversationSummary } from "@/lib/contract/types";
import { formatTime } from "@/lib/time";
import { ErrorNotice, StatusBadge } from "@/components/ui";

export default function ActivityPage() {
  const { workspace, zone } = useWorkspace();
  const wsId = workspace?.id ?? null;
  const work = useWorkOverview(wsId);
  const conversations = useResource<ConversationSummary[]>(
    wsId && CAPABILITIES.conversation ? `conversations:${wsId}` : null,
    (signal) => conversationApi.list(wsId!, signal),
  );
  const ready =
    Boolean(work.data) && (!CAPABILITIES.conversation || conversations.data);
  const items = activityFrom(work.data ?? [], conversations.data ?? []);
  const days: { label: string; items: typeof items }[] = [];
  for (const item of items) {
    const label = dayLabel(item.at, zone);
    const last = days.at(-1);
    if (last?.label === label) last.items.push(item);
    else days.push({ label, items: [item] });
  }

  return (
    <div className="agent-col">
      <p className="context-line">
        <span className="dot" aria-hidden="true" />
        Activity
      </p>
      <header className="stack">
        <h1>Activity</h1>
        <p className="lede">
          Where each piece of work and conversation stands, latest change first.
        </p>
      </header>
      {work.error && !work.data ? <ErrorNotice error={work.error} /> : null}
      {conversations.error && !conversations.data ? (
        <ErrorNotice error={conversations.error} />
      ) : null}
      {!ready && !work.error ? (
        <p role="status" className="muted">
          Loading activity…
        </p>
      ) : null}
      {ready && !items.length ? (
        <p className="muted">Nothing yet. What you start shows up here.</p>
      ) : null}
      {days.map((d) => (
        <section key={d.label} className="activity-day" aria-label={d.label}>
          <h2 className="section-title">{d.label}</h2>
          <ul className="work-list">
            {d.items.map((i) => (
              <li key={i.id}>
                <Link className="work-row" href={i.href} data-activity={i.id}>
                  <span className="work-row-main">
                    <span className="work-row-title clamp-2">{i.title}</span>
                    <span className="work-row-status">
                      {i.kind === "work" ? (
                        <StatusBadge label={i.status} tone={i.tone} />
                      ) : (
                        <span className="work-row-note">{i.status}</span>
                      )}
                      <span className="work-row-note">
                        {i.timeLabel === "started" ? "Started" : "Updated"}{" "}
                        {formatTime(i.at, zone)}
                      </span>
                    </span>
                  </span>
                  <span className="work-row-go" aria-hidden="true">
                    ↗
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="hint">
        Work shows when it last changed; conversations show when they started. A
        step-by-step history isn’t available yet.
      </p>
    </div>
  );
}
