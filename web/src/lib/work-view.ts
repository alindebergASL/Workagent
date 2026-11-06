/**
 * Plain-language view of a work-v1 snapshot. Pure: no clocks, no fetches.
 *
 * Current state comes only from the snapshot's typed fields. Earlier check-in
 * text is always labelled as earlier, with its time. Nothing here claims a
 * worker is live unless the snapshot says it was observed live, and nothing
 * turns a ready result or accepted proposal into "complete".
 */
import type {
  CurrentExecution,
  PendingReview,
  WorkEvent,
  WorkResponsibility,
  WorkSnapshot,
} from "@/lib/contract/work-events";

export type Tone = "" | "status-working" | "status-attention" | "status-error";

export interface ExecutionView {
  label: string;
  tone: Tone;
  /** One sentence on what is true right now. */
  text: string;
  /** Unknown outcome: shown prominently; must not be retried blindly. */
  unresolved: boolean;
}

export function executionView(e: CurrentExecution): ExecutionView | null {
  switch (e.state) {
    case "idle":
      return null;
    case "unknown":
      return {
        label: "Outcome unknown",
        tone: "status-error",
        text: "Workagent couldn’t confirm what happened to the last request. Check the saved work before asking again; it won’t be retried automatically.",
        unresolved: true,
      };
    case "queued":
      return e.admission === "admitted"
        ? {
            label: "Queued",
            tone: "status-working",
            text: "Accepted and waiting for a worker. Nothing has started yet.",
            unresolved: false,
          }
        : {
            label: "Waiting to start",
            tone: "status-working",
            text: "Not yet accepted to run. Nothing has started.",
            unresolved: false,
          };
    case "running":
      return e.worker_live
        ? {
            label: "Working",
            tone: "status-working",
            text: "A worker is on this now.",
            unresolved: false,
          }
        : {
            label: "Running, not confirmed",
            tone: "status-attention",
            text: "Recorded as running, but no live worker has been seen.",
            unresolved: false,
          };
    case "awaiting_provider":
      return {
        label: "Waiting on the model",
        tone: "status-working",
        text: "Sent to the model service; waiting for its answer.",
        unresolved: false,
      };
    case "recovering":
      return {
        label: "Recovering",
        tone: "status-attention",
        text: "Picking the work back up after an interruption.",
        unresolved: false,
      };
    case "stale":
      return {
        label: "No recent progress",
        tone: "status-attention",
        text: "Nothing new has been recorded for a while.",
        unresolved: false,
      };
    case "stopped":
      return {
        label: "Stopped",
        tone: "",
        text: "This run was stopped. What it saved is kept.",
        unresolved: false,
      };
    case "waiting_person":
      return {
        label: "Waiting for you",
        tone: "status-attention",
        text: "Needs your input before it can go on.",
        unresolved: false,
      };
    case "blocked":
      return {
        label: "Blocked",
        tone: "status-attention",
        text: "Can’t go on until something changes.",
        unresolved: false,
      };
  }
}

const RESP_LABEL: Record<WorkResponsibility["state"], string> = {
  active: "Active",
  waiting_person: "Waiting for you",
  waiting_event: "Waiting for a change",
  blocked: "Blocked",
  paused: "Paused",
  cancelled: "Cancelled",
  taken_over: "Taken over",
};

export interface ResponsibilityView {
  id: string;
  label: string;
  tone: Tone;
  next: string;
  checkIn: string | null;
  reviewRequired: boolean;
  earlier: { text: string; at: string | null } | null;
}

export function responsibilityView(r: WorkResponsibility): ResponsibilityView {
  return {
    id: r.assignment_id,
    label: RESP_LABEL[r.state],
    tone:
      r.state === "blocked" || r.state === "waiting_person"
        ? "status-attention"
        : r.state === "active"
          ? "status-working"
          : "",
    next: r.next_action.description,
    // A check-in only means something while the responsibility is live.
    checkIn:
      r.state === "cancelled" || r.state === "taken_over"
        ? null
        : r.next_check_in_at,
    reviewRequired: r.review_required,
    earlier: r.historical_observation
      ? {
          text: r.historical_observation.text,
          at: r.historical_observation.observed_at,
        }
      : null,
  };
}

export function reviewNote(p: PendingReview): string {
  const parts = [
    !p.fresh || !p.is_latest
      ? "Based on an earlier version"
      : "Waiting for your review",
  ];
  if (p.removed_content_count > 0)
    parts.push(
      `removes ${p.removed_content_count} item${p.removed_content_count === 1 ? "" : "s"}`,
    );
  return parts.join(" · ");
}

const FACT: Record<WorkEvent["type"], string> = {
  "conversation.changed": "Conversation updated",
  "message.created": "New message",
  "run.changed": "Run state changed",
  "artifact.changed": "Saved work changed",
  "revision.created": "New version saved",
  "proposal.changed": "Proposed change updated",
  "responsibility.changed": "Responsibility updated",
  "receipt.recorded": "Service receipt recorded",
  "audit.recorded": "Activity recorded",
};

export const factLabel = (f: WorkEvent) =>
  f.reason_code === "review_required"
    ? "Needs your review"
    : f.reason_code === "cancelled_unapplied"
      ? "Cancelled; nothing applied"
      : FACT[f.type];

export function hasWork(s: WorkSnapshot): boolean {
  return (
    s.execution.state !== "idle" ||
    s.responsibility.length > 0 ||
    s.artifacts.length > 0 ||
    s.pending_proposals.length > 0
  );
}
