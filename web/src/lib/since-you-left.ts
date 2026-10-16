import type { ConversationWork } from "@/lib/client/conversation-work";

/**
 * What changed in the person's work since this device last showed Home,
 * from saved records only: a proposed version waiting for them, or a version
 * Workagent saved. The person's own saves and proposals made for an earlier
 * version aren't news, so they're left to the lists below. Nothing here says
 * a proposal is accepted or that work is finished.
 */
export interface SinceEntry {
  work: ConversationWork;
  what: "proposed" | "saved";
  at: string;
}

const time = (iso: string | null | undefined) => {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? null : t;
};

/** After the marker, or never when there's no marker (a first visit). */
const after = (iso: string, since: string | null) => {
  const t = time(iso);
  const s = time(since);
  return t !== null && s !== null && t > s;
};

export function sinceYouLeft(
  made: ConversationWork[],
  since: string | null,
): SinceEntry[] {
  const entries: SinceEntry[] = [];
  for (const work of made) {
    if (work.decision) {
      if (work.decision.fresh && after(work.decision.created_at, since))
        entries.push({ work, what: "proposed", at: work.decision.created_at });
    } else if (work.saved_by === "agent" && after(work.updated_at, since)) {
      entries.push({ work, what: "saved", at: work.updated_at });
    }
  }
  return entries.sort((a, b) => (time(b.at) ?? 0) - (time(a.at) ?? 0));
}

/**
 * The newest time among the records shown, from the service's own
 * timestamps, so the marker never depends on this device's clock.
 */
export function highWater(made: ConversationWork[]): string | null {
  let best: string | null = null;
  for (const w of made)
    for (const iso of [w.updated_at, w.decision?.created_at]) {
      const t = time(iso);
      if (t !== null && (best === null || t > time(best)!)) best = iso!;
    }
  return best;
}

/** True when `next` is later than `prev` (or there is no `prev`). */
export function later(next: string | null, prev: string | null): boolean {
  const n = time(next);
  if (n === null) return false;
  const p = time(prev);
  return p === null || n > p;
}

const COUNT = ["No", "One", "Two", "Three", "Four", "Five"];
const count = (n: number) => COUNT[n] ?? String(n);

/**
 * Home's one-line orientation, from counts taken from current records: what
 * needs the person and what Workagent saved since they left. Null when
 * there's nothing to say, so the usual greeting line stands. It never says
 * work is done or accepted.
 */
export function homeSummary({
  needs,
  savedSince,
}: {
  needs: number;
  savedSince: number;
}): string | null {
  const parts: string[] = [];
  if (needs)
    parts.push(
      needs === 1 ? "One thing needs you." : `${count(needs)} things need you.`,
    );
  if (savedSince)
    parts.push(
      savedSince === 1
        ? "Workagent saved a new version of one piece of work since you left."
        : `Workagent saved new versions of ${count(savedSince).toLowerCase()} pieces of work since you left.`,
    );
  return parts.length ? parts.join(" ") : null;
}

/**
 * The most recently changed work, for "Pick up where you left off": newest
 * first by its latest saved version or proposal.
 */
export function recentWork(
  made: ConversationWork[],
  limit = 3,
): ConversationWork[] {
  const at = (w: ConversationWork) =>
    Math.max(time(w.updated_at) ?? 0, time(w.decision?.created_at) ?? 0);
  return [...made].sort((a, b) => at(b) - at(a)).slice(0, limit);
}
