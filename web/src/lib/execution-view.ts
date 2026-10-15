import type { components } from "../../../contracts/src/client";

type S = components["schemas"];
export type ExecutionStatus = S["ExecutionStatus"];
export type RunExecution = S["RunExecution"];

/** What the execution read adds to a turn that hasn't been answered yet. */
export interface TurnExecution {
  text: string;
  /**
   * The turn isn't moving (not running, or stopped): this replaces any
   * in-progress wording. Otherwise it's said alongside it.
   */
  replaces: boolean;
}

const NOT_RUNNING =
  "Workagent isn’t running right now. Your message is kept and is answered once it’s back.";

const STOPPED: Record<NonNullable<RunExecution["failure_category"]>, string> = {
  unknown_external_outcome:
    "Stopped: it couldn’t confirm whether a step went through, so nothing is retried on its own.",
  invalid_response: "Stopped: the answer it got couldn’t be used.",
  authority_or_budget:
    "Stopped: it reached the limit it’s allowed for this. Your message is kept.",
  internal_error: "Stopped by an internal error. Your message is kept.",
  worker_unavailable: NOT_RUNNING,
  work_blocked: "Stopped: the work can’t go further as asked.",
};

/**
 * A pending turn's run, as the service last checked it. Only for turns not
 * yet answered: whether something is answering it is the service's to say,
 * and a missing heartbeat is "not running", never "working". The turn's own
 * recorded state still decides whether it was answered.
 */
export function turnExecution(
  runId: string,
  status: ExecutionStatus | null | undefined,
): TurnExecution | null {
  if (!status) return null;
  const run = status.runs.find((r) => r.run_id === runId);
  const state =
    run?.state ?? (status.state === "unavailable" ? "unavailable" : null);
  switch (state) {
    case "unavailable":
      return { text: NOT_RUNNING, replaces: true };
    case "blocked":
      return {
        text: run?.failure_category
          ? STOPPED[run.failure_category]
          : "Stopped.",
        replaces: true,
      };
    case "awaiting_provider":
      return { text: "Waiting for the model’s answer.", replaces: false };
    case "recovering":
      return {
        text: "Picking this up again after an interruption.",
        replaces: false,
      };
    case "waiting_for_person":
      return {
        text: "Waiting for you: there’s something to review.",
        replaces: true,
      };
    default:
      return null;
  }
}

/**
 * One line for the workspace: whether Workagent can take on work now. Being
 * able to reach the service isn't the same as it running. Nothing here stops
 * the person reading, editing or asking; a request made while it can't run
 * waits for it.
 */
export function workspaceExecution(
  status: ExecutionStatus | null | undefined,
  unreadable: boolean,
): { state: string; text: string } | null {
  if (!status)
    return unreadable
      ? {
          state: "unknown",
          text: "Couldn’t check whether Workagent is running.",
        }
      : null;
  switch (status.state) {
    case "unavailable":
      return {
        state: "unavailable",
        text: "Workagent isn’t running right now. You can read and edit your work; new requests wait until it’s back.",
      };
    case "blocked":
      return status.can_advance_authorized_work
        ? null
        : {
            state: "blocked",
            text: "Workagent can’t take on new work here right now. Your work and drafts are unaffected.",
          };
    case "working":
    case "awaiting_provider":
    case "recovering":
      return { state: "working", text: "Workagent is working on a request." };
    default:
      return null;
  }
}
