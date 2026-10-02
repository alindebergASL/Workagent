import type { Assignment, AssignmentSummary } from "./contract/types";

/**
 * Where a piece of work stands, derived only from persisted domain state
 * (assignment state, artifacts, pending proposals). Never from client flags,
 * so a completed item can't keep showing in-progress or delegation controls.
 */
export type WorkPhase =
  "decision" | "blocked" | "working" | "completed" | "stopped";

export interface WorkItem {
  summary: AssignmentSummary;
  /** Present when the detail read succeeded; carries artifacts and pending reviews. */
  detail: Assignment | null;
}

export function reviewIds(item: WorkItem): string[] {
  const fromDetail = item.detail?.needs_review_artifact_ids ?? [];
  return fromDetail.length
    ? fromDetail
    : item.summary.needs_review_artifact_ids;
}

export function phaseOf(item: WorkItem): WorkPhase {
  if (reviewIds(item).length) return "decision";
  const state = item.detail?.state ?? item.summary.state;
  switch (state) {
    case "needs_input":
    case "failed":
      return "blocked";
    case "queued":
    case "working":
      return "working";
    case "stopped":
      return "stopped";
    case "ready_for_review":
    case "finished":
      return "completed";
  }
}

export interface Attention {
  item: WorkItem;
  eyebrow: string;
  title: string;
  body: string;
  action: string;
  href: string;
}

/**
 * The single "timely decision" for Home: a proposal waiting on the person, or
 * work that cannot continue without them. Completed and in-progress work are
 * not decisions and never produce a call to action here.
 */
export function workAttention(items: WorkItem[]): Attention | null {
  const decision = items.find((i) => phaseOf(i) === "decision");
  if (decision) {
    const artifactId = reviewIds(decision)[0]!;
    const title =
      decision.detail?.artifacts.find((a) => a.id === artifactId)?.title ??
      "Saved work";
    return {
      item: decision,
      eyebrow: "One decision for you",
      title: `A proposed change to your ${title.toLowerCase()} is waiting.`,
      body: "Nothing is applied until you decide. Your saved version stays as it is.",
      action: "Review the change",
      href: `/assignments/${decision.summary.id}/artifacts/${artifactId}`,
    };
  }
  const blocked = items.find((i) => phaseOf(i) === "blocked");
  if (blocked) {
    const unresolved = blocked.detail?.unresolved[0];
    return {
      item: blocked,
      eyebrow: "Needs you",
      title: "This work can't continue on its own.",
      body:
        unresolved ?? "Saved results are kept. Open it to see what is missing.",
      action: "See what’s needed",
      href: `/assignments/${blocked.summary.id}`,
    };
  }
  return null;
}

/** A short, readable title from the person's request: its first sentence, bounded. */
export function shortTitle(goal: string, max = 72): string {
  const text = goal.trim().replace(/\s+/g, " ");
  const first = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
  if (first.length <= max) return first.replace(/[.!?]$/, "");
  const cut = first.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
}

export const isWorking = (i: WorkItem) => phaseOf(i) === "working";
export const isCompleted = (i: WorkItem) => phaseOf(i) === "completed";

/** What was produced, in plain words, from saved artifacts only. */
export function completedSummary(item: WorkItem): string {
  const artifacts = item.detail?.artifacts ?? [];
  if (!artifacts.length) return "Saved results are available.";
  const names = artifacts.map((a) => a.title.toLowerCase());
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `Prepared ${list}.`;
}
