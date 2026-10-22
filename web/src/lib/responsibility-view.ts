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

export const BLOCKER: Record<NonNullable<Lifecycle["blocker"]>, string> = {
  grant_required: "It needs a permission that hasn’t been granted.",
  tool_required: "It needs a tool that isn’t available.",
  authority_unavailable: "The authority it relies on isn’t available.",
  conversation_closed: "Its conversation has ended.",
};

/**
 * Where running this responsibility stands, in one short line. Keyed by the
 * generated execution status, so every status the contract adds must be
 * worded here before it compiles.
 */
const EXECUTION: Record<Lifecycle["execution_status"], string> = {
  not_admitted: "Nothing is running for it right now.",
  queued: "Queued to run; it hasn’t started.",
  running: "Running now; not done yet.",
  settled: "Its latest run finished. The result needs your review.",
  blocked: "Its run is blocked.",
};

/**
 * The same, in full, for Details: what the record does and doesn't claim
 * (admission is not dispatch, and a run is not the goal done).
 */
const EXECUTION_DETAIL: Record<Lifecycle["execution_status"], string> = {
  not_admitted:
    "It hasn’t been admitted to run, so nothing runs in the background for it.",
  queued:
    "It’s admitted to run and waiting its turn. Queued isn’t the same as started.",
  running:
    "The service records a run in progress. Running isn’t the same as done.",
  settled:
    "Its latest run finished and its result is recorded. That result isn’t accepted, and the goal isn’t marked done.",
  blocked:
    "Its run is blocked. Some work may already have happened, so check its run.",
};

/**
 * A recorded responsibility, in plain words, from its lifecycle only. It
 * never claims work is running: execution isn't admitted yet, and a queued
 * review is a record, not activity.
 */
export function responsibilityView(life: Lifecycle) {
  const closed = life.state === "cancelled" || life.state === "taken_over";
  const lines: string[] = [];
  const changed = (life.observations ?? []).filter((o) => o.changed).length;
  if (changed)
    lines.push(
      `${changed} thing${changed === 1 ? "" : "s"} it depends on changed since it was recorded.`,
    );
  // What it needs from the person, if anything: a review, or what blocks it.
  const review =
    life.review_required ||
    life.outcome_status === "needs_review" ||
    life.execution_status === "settled";
  // A decision it asks for is the person's to make, said in its own words.
  const decision =
    life.next_action.kind === "request_decision"
      ? life.next_action.description.trim() || "A decision from you."
      : null;
  const needsYou = closed
    ? null
    : life.blocker
      ? BLOCKER[life.blocker]
      : review
        ? "Your review of its result."
        : decision;
  const allowed: Operation[] = closed
    ? []
    : life.state === "paused"
      ? ["resume", "cancel", "takeover"]
      : ["pause", "cancel", "takeover"];
  const checkingBack =
    life.state === "waiting_event" && life.wait?.kind === "check_in";
  return {
    state:
      !closed &&
      life.state === "active" &&
      (life.execution_status === "queued" ||
        life.execution_status === "running")
        ? "Workagent is on it"
        : checkingBack
          ? "Checks back later"
          : STATE[life.state],
    closed,
    /** Waiting for its own scheduled check-in, said by its time. */
    checkingBack: !closed && checkingBack,
    /**
     * What it waits on (a person, or something changing). A scheduled
     * check-in is said by its time instead, so its reason isn't repeated.
     */
    waiting:
      closed || life.wait?.kind === "check_in"
        ? null
        : (life.wait?.reason ?? null),
    /**
     * Whether its run state is worth saying up front: queued, running,
     * blocked or settled. "Nothing is running" stays in Details.
     */
    executionMatters:
      !closed &&
      (life.execution_status === "queued" ||
        life.execution_status === "running" ||
        life.execution_status === "blocked" ||
        life.execution_status === "settled"),
    needsYou,
    outcome: life.current_outcome,
    // Not said twice: a decision asked for is already what it needs from you.
    next:
      closed || (decision && needsYou === decision)
        ? null
        : life.next_action.description,
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
    executionDetail: closed ? null : EXECUTION_DETAIL[life.execution_status],
    allowed,
    /** The run the service bound to this responsibility, if any. */
    runId: life.run_id ?? null,
  };
}
