import type { components } from "../../../contracts/src/client";

type S = components["schemas"];
type Lifecycle = S["ResponsibilityLifecycle"];
type Operation = S["ControlResponsibility"]["operation"];

const STATE: Record<Lifecycle["state"], string> = {
  active: "Recorded as yours to carry forward",
  waiting_person: "Waiting for a person",
  waiting_event: "Waiting for something to change",
  blocked: "Blocked",
  paused: "Paused",
  cancelled: "Stopped",
  taken_over: "You took this back",
};

const BLOCKER: Record<NonNullable<Lifecycle["blocker"]>, string> = {
  grant_required: "It needs a permission that hasn’t been granted.",
  tool_required: "It needs a tool that isn’t available.",
  authority_unavailable: "The authority it relies on isn’t available.",
  conversation_closed: "Its conversation has ended.",
};

/**
 * What the service records about running this responsibility, in words that
 * claim no more than the record: admission is not dispatch, and a run is not
 * the goal done. Keyed by the generated execution status, so every status the
 * contract adds must be worded here before it compiles.
 */
const EXECUTION: Record<Lifecycle["execution_status"], string> = {
  not_admitted:
    "Not admitted to run: nothing runs in the background for it right now.",
};

/**
 * A recorded responsibility, in plain words, from its lifecycle only. It
 * never claims work is running: execution isn't admitted yet, and a queued
 * review is a record, not activity.
 */
export function responsibilityView(life: Lifecycle) {
  const closed = life.state === "cancelled" || life.state === "taken_over";
  const lines: string[] = [];
  if (life.wait?.reason) lines.push(`Waiting: ${life.wait.reason}`);
  if (life.blocker) lines.push(BLOCKER[life.blocker]);
  const changed = (life.observations ?? []).filter((o) => o.changed).length;
  if (changed)
    lines.push(
      `${changed} thing${changed === 1 ? "" : "s"} it depends on changed since it was recorded.`,
    );
  if (life.review_required || life.outcome_status === "needs_review")
    lines.push("Needs your review.");
  const allowed: Operation[] = closed
    ? []
    : life.state === "paused"
      ? ["resume", "cancel", "takeover"]
      : ["pause", "cancel", "takeover"];
  return {
    state: STATE[life.state],
    closed,
    outcome: life.current_outcome,
    next: closed ? null : life.next_action.description,
    lines,
    checkIn: closed ? null : (life.next_check_in_at ?? null),
    checkInDue: !closed && life.check_in_due,
    reviewQueued: !closed && life.wake_status === "queued",
    // Closed means no one holds it through Workagent any more.
    execution: closed
      ? life.state === "taken_over"
        ? "It’s back with you. Workagent isn’t holding it any more."
        : "Stopped. Nothing further runs for it."
      : EXECUTION[life.execution_status],
    allowed,
  };
}
