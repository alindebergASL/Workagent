import type { HoldEntry } from "./client/responsibility";
import { responsibilityView } from "./responsibility-view";

/**
 * Where a piece of handed-over work stands, in the same words on every list
 * (Home, a Space, a conversation's hand-overs), from what the service
 * returned for it. Active isn't running, a settled run isn't the goal done,
 * and an unread or refused read never becomes "nothing here".
 */
export interface HoldStatus {
  label: string;
  note: string;
  tone: string;
}

const RUN: Record<string, string> = {
  not_admitted: "Nothing runs for it right now.",
  queued: "Queued to run; not started.",
  running: "A run is in progress; not done.",
  settled: "Its latest run finished; that result needs your review.",
  blocked: "Its run is blocked; check what happened.",
};

export function holdStatus(entry: HoldEntry | undefined): HoldStatus | null {
  if (!entry) return null;
  switch (entry.kind) {
    case "ready": {
      const life = entry.detail.lifecycle;
      const view = responsibilityView(life);
      const review =
        !view.closed &&
        (life.review_required || life.outcome_status === "needs_review");
      const note = view.closed
        ? view.execution
        : review
          ? `Needs your review before it continues. ${RUN[life.execution_status]}`
          : `${RUN[life.execution_status]} Outcome not verified.`;
      return {
        label: view.state,
        note: entry.stale
          ? `Last read only; can’t re-check right now. ${note}`
          : note,
        tone: view.closed
          ? ""
          : life.state === "waiting_person" ||
              life.state === "blocked" ||
              life.review_required
            ? "status-attention"
            : life.execution_status === "running" ||
                life.execution_status === "queued"
              ? "status-working"
              : "",
      };
    }
    case "absent":
      return entry.assignment.state === "cancelled"
        ? { label: "Stopped", note: "Saved results are kept.", tone: "" }
        : entry.assignment.state === "paused"
          ? {
              label: "Paused hand-over",
              note: "Nothing runs for it. Open it to see what was recorded.",
              tone: "",
            }
          : null;
    case "denied":
      return {
        label: "Not available",
        note: "You can’t see where this stands now.",
        tone: "",
      };
    case "unknown":
      return {
        label: "Couldn’t check",
        note: entry.lastAbsent
          ? "Couldn’t re-check where this stands; it may have changed."
          : "Couldn’t read where this stands right now.",
        tone: "",
      };
  }
}

/**
 * Which Home group a read responsibility belongs in: needing the person,
 * held (recorded, not running) or closed. Null when there is no current
 * responsibility read, so the item keeps its usual place.
 */
export function holdGroup(
  entry: HoldEntry | undefined,
): "attention" | "holding" | "closed" | null {
  if (entry?.kind !== "ready") return null;
  const life = entry.detail.lifecycle;
  if (life.state === "cancelled" || life.state === "taken_over")
    return "closed";
  if (
    life.state === "waiting_person" ||
    life.state === "blocked" ||
    life.review_required ||
    life.outcome_status === "needs_review" ||
    life.execution_status === "settled" ||
    life.execution_status === "blocked"
  )
    return "attention";
  return "holding";
}
