import type { Assignment, AssignmentSummary } from "./contract/types";

/**
 * Where a piece of work stands, derived only from the authoritative read
 * summary (`assignmentSummary` in the domain adapter): assignment state plus
 * actual artifact and proposal receipts. Never from client flags, so finished
 * work cannot keep in-progress or delegation controls, and prepared work never
 * silently loses the review it needs.
 *
 * - decision: a proposed revision waits on the person.
 * - prepared: work is ready to inspect; nothing has been approved yet.
 * - approved: the current revision is an accepted proposal. This is not an
 *   external effect and not fulfilment of every responsibility criterion.
 */
export type WorkPhase =
  "decision" | "blocked" | "working" | "prepared" | "approved" | "stopped";

export function phaseOf(a: AssignmentSummary): WorkPhase {
  if (a.needs_review_artifact_ids.length) return "decision";
  switch (a.state) {
    case "needs_input":
    case "failed":
      return "blocked";
    case "queued":
    case "working":
      return "working";
    case "stopped":
      return "stopped";
    case "finished":
      return "approved";
    case "ready_for_review":
      return "prepared";
  }
}

export interface Attention {
  item: AssignmentSummary;
  eyebrow: string;
  title: string;
  body: string;
  action: string;
  href: string;
}

/**
 * The one timely thing for Home, in order: a proposal waiting on the person,
 * work that cannot continue without them, then prepared work awaiting
 * inspection. In-progress and approved work are never presented as decisions.
 */
export function workAttention(items: AssignmentSummary[]): Attention | null {
  const decision = items.find((i) => phaseOf(i) === "decision");
  if (decision)
    return {
      item: decision,
      eyebrow: "One decision for you",
      title: "A proposed revision is waiting for your decision.",
      body: "Nothing is applied until you decide. Your saved version stays as it is.",
      action: "Review the change",
      href: `/assignments/${decision.id}/artifacts/${decision.needs_review_artifact_ids[0]}`,
    };
  const blocked = items.find((i) => phaseOf(i) === "blocked");
  if (blocked)
    return {
      item: blocked,
      eyebrow: "Needs you",
      title: "This work can’t continue on its own.",
      body:
        blocked.next_step ??
        "Saved results are kept. Open it to see what is missing.",
      action: "See what’s needed",
      href: `/assignments/${blocked.id}`,
    };
  const prepared = items.find((i) => phaseOf(i) === "prepared");
  if (prepared)
    return {
      item: prepared,
      eyebrow: "Ready for you",
      title: "Your prepared work is ready to inspect.",
      body: "Review it, edit anything, or ask for a revision. Nothing is approved until you decide.",
      action: "Open prepared work",
      href: `/assignments/${prepared.id}`,
    };
  return null;
}

export const isWorking = (i: AssignmentSummary) => phaseOf(i) === "working";

/** What was produced, in plain words, from saved artifacts when the detail read has them. */
export function completedSummary(a: AssignmentSummary | Assignment): string {
  const artifacts = "artifacts" in a ? a.artifacts : [];
  if (!artifacts.length)
    return a.latest_result ?? "Saved results are available.";
  const names = artifacts.map((x) => x.title.toLowerCase());
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `Prepared ${list}.`;
}

/** A short, readable title from the person's request: its first sentence, bounded. */
export function shortTitle(goal: string, max = 72): string {
  const text = goal.trim().replace(/\s+/g, " ");
  const first = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
  if (first.length <= max) return first.replace(/[.!?]$/, "");
  const cut = first.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
}
