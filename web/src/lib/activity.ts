import type { AssignmentSummary, ConversationSummary } from "./contract/types";
import {
  decisionArtifactId,
  phaseOf,
  shortTitle,
  statusOf,
} from "./work-state";

/**
 * Activity across work and conversations: each item's most recent recorded
 * change, newest first. There is no event-history route yet, so this never
 * invents intermediate steps; it shows where each thing stands and when it
 * last changed.
 */
export interface ActivityItem {
  id: string;
  kind: "work" | "conversation";
  title: string;
  status: string;
  tone: string;
  at: string;
  href: string;
}

export function activityFrom(
  work: AssignmentSummary[],
  conversations: ConversationSummary[],
): ActivityItem[] {
  const items: ActivityItem[] = [
    ...work.map((a) => {
      const s = statusOf(a);
      const review = decisionArtifactId(a);
      return {
        id: `work:${a.id}`,
        kind: "work" as const,
        title: shortTitle(a.title),
        status: s.label,
        tone: s.tone,
        at: a.updated_at || a.created_at,
        href:
          phaseOf(a) === "decision" && review
            ? `/assignments/${a.id}/artifacts/${review}`
            : `/assignments/${a.id}`,
      };
    }),
    ...conversations.map((c) => ({
      id: `conversation:${c.id}`,
      kind: "conversation" as const,
      title: c.title,
      status:
        c.state === "open" ? "Conversation started" : "Conversation ended",
      tone: "",
      at: c.created_at,
      href: `/conversations/${c.id}`,
    })),
  ];
  return items
    .filter((i) => i.at)
    .sort((x, y) => y.at.localeCompare(x.at) || x.id.localeCompare(y.id));
}

/** "Today", "Yesterday" or a date, in the display zone. */
export function dayLabel(iso: string, zone: string, now = new Date()): string {
  const key = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const day = key(new Date(iso));
  if (day === key(now)) return "Today";
  if (day === key(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}
