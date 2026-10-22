import {
  recordedResponsibilities,
  type TurnProgress,
} from "./contract/natural";
import type { TurnState } from "./contract/types";

type Verification = NonNullable<
  NonNullable<TurnProgress["adaptive"]>["steps"]
>[number]["verification"];

/**
 * What the model's own examples showed for one step. The service reports
 * `model_tests_passed: false` both when examples failed and when there were
 * none to run, so the recorded checks decide which: no examples is "none",
 * never a failure.
 */
export function modelExamples(
  v: Verification,
):
  | { state: "none" }
  | { state: "passed" | "failed"; passed: number; total: number } {
  const checks = v.checks ?? [];
  if (!checks.length)
    return v.model_tests_passed
      ? { state: "passed", passed: 0, total: 0 }
      : { state: "none" };
  const passed = checks.filter((c) => c.passed).length;
  return {
    state:
      passed === checks.length && v.model_tests_passed ? "passed" : "failed",
    passed,
    total: checks.length,
  };
}

/**
 * Whether a retained local result is actual product output (a calculation,
 * a document, a file). A step that only recorded a responsibility retains
 * no output, and must never read as an unsaved calculation.
 */
export function hasProductOutput(
  local: TurnProgress["retained_local_result"] | undefined,
): boolean {
  return Boolean(local && (local.output || local.body));
}

/** Presentation only. Never changes a run's authority or promotes examples to proof. */
/**
 * A selection phase's place in the turn: "selection" is the first and
 * "selection_N" the Nth, however many the service allows. Anything else
 * (the final phase, or one not recognised) never counts as a later attempt.
 */
function selectionOrder(phase: string): number {
  if (phase === "selection") return 1;
  const m = /^selection_(\d+)$/.exec(phase);
  return m ? Number(m[1]) : -Infinity;
}

export function adaptivePresentation(
  state: TurnState,
  progress?: TurnProgress,
  /** The turn saved work of its own (shown beside it), whatever its local result. */
  savedWork = false,
) {
  const adaptive = progress?.adaptive;
  if (
    !adaptive ||
    state === "cancelled" ||
    adaptive.outcome === "cancelled" ||
    state === "outcome_unknown"
  )
    return null;
  if (
    progress.provider_observation === "outcome_unknown" ||
    progress.provider_observation === "invalid"
  )
    return {
      // A stopped attempt is kept as it is: never offered as something to
      // ask again, which could duplicate or bypass what's known about it.
      title:
        progress.provider_observation === "invalid"
          ? "This request stopped: its answer couldn’t be used"
          : "This request stopped: whether it went through is unknown",
      note:
        progress.provider_observation === "invalid"
          ? "That answer wasn’t used and won’t be retried on its own. Anything already saved, including your edits, is unchanged. This isn’t a completed result."
          : "It won’t be sent again on its own, so nothing is duplicated. Anything already saved, including your edits, is unchanged. This isn’t a completed result.",
      checks: null,
      changedAttempts: 0,
    };
  const steps = adaptive.steps ?? [];
  const failed = (s: (typeof steps)[number]) =>
    s.status === "rejected" ||
    (s.verification.automatic?.recognized === true &&
      s.verification.automatic.passed === false) ||
    s.verification.acceptance?.passed === false ||
    modelExamples(s.verification).state === "failed";
  const changedAttempts = steps.slice(1).filter((s, i) => {
    const before = steps[i];
    return (
      before &&
      failed(before) &&
      !!before.operation_hash &&
      !!s.operation_hash &&
      before.operation_hash !== s.operation_hash
    );
  }).length;
  const local = progress.retained_local_result;
  // A responsibility the turn saved, with no product output: say what was
  // saved and what isn't known, never "calculated but not saved".
  const recorded = recordedResponsibilities(progress);
  if (
    recorded.length &&
    !hasProductOutput(local) &&
    state !== "queued" &&
    state !== "responding"
  )
    return {
      title:
        recorded.length === 1
          ? "Responsibility recorded"
          : `${recorded.length} responsibilities recorded`,
      note: "At recording, the outcome wasn’t verified and no execution was admitted. Open the current responsibility for its latest status.",
      checks: null,
      changedAttempts: 0,
    };
  const last = steps.at(-1);
  const bound =
    !!last?.operation_hash &&
    last.operation_hash === local?.binding.operation_hash;
  const checks =
    bound &&
    last?.verification.acceptance?.passed &&
    last.verification.acceptance.operation_hash === last.operation_hash &&
    last.verification.acceptance.checks.length > 0 &&
    last.verification.acceptance.checks.every((c) => c.passed)
      ? "Supplied checks passed — those cases only."
      : bound && last && modelExamples(last.verification).state === "passed"
        ? "Model examples passed — not independent checks."
        : null;
  if (state === "queued" || state === "responding") {
    const nextObserved =
      last &&
      failed(last) &&
      progress.response_steps?.some(
        (s) =>
          selectionOrder(s.phase) > selectionOrder(last.phase) &&
          ["accepted", "received"].includes(s.state),
      );
    return nextObserved
      ? {
          title: "Trying another approach",
          note: "An earlier attempt failed; the next model step is underway.",
          checks: null,
          changedAttempts,
        }
      : null;
  }
  const automatic = last?.verification.automatic;
  if (
    state === "replied" &&
    adaptive.outcome === "completed" &&
    progress.provider_observation === "received" &&
    local?.published &&
    local.status === "observed" &&
    bound &&
    last?.verification.basis === "independent_bounded" &&
    last.verification.satisfied &&
    last.verification.requested_goal_status === "satisfied" &&
    automatic?.recognized &&
    automatic.passed &&
    automatic.failures.length === 0 &&
    automatic.operation_hash === last.operation_hash
  )
    return {
      title: "Requested result verified",
      note: "The recorded result passed an independent check within the stated scope. Any pending proposals still need your approval; later edits are not covered.",
      checks: automatic.row_count
        ? `Checked every supplied row (${automatic.row_count}).`
        : `Checked the complete supported input range (${automatic.case_count ?? 0} combinations).`,
      changedAttempts,
    };
  if (
    adaptive.outcome === "needs_validation" &&
    local?.published &&
    local.status === "observed"
  )
    return {
      title: "Result saved — needs review",
      note: "Your request is not yet verified. Open the saved work to inspect its current version and any pending proposals.",
      checks,
      changedAttempts,
    };
  // Its last attempt was refused and that is why it stopped (out of steps
  // trying, or blocked): say so, not that a limit was reached. A budget stop
  // stays a budget stop.
  if (stoppedByRefusal(progress))
    return {
      title: "Stopped: what it tried wasn’t possible here",
      note: savedWork
        ? "Its last attempt was refused, so nothing from it was applied. Review what it saved before continuing."
        : "Its attempts were refused, so nothing from them was applied and it didn’t reply. Your saved work is unchanged; you can ask for it another way.",
      checks: null,
      changedAttempts,
    };
  const titles: Partial<Record<typeof adaptive.outcome, string>> = {
    step_limit: "Stopped at the step limit",
    budget_limit: "Stopped at the budget limit",
    blocked: "Couldn’t continue",
    waiting_for_user: "Needs your input",
    needs_validation: "Result needs review",
  };
  const title = titles[adaptive.outcome];
  if (!title) return null;
  return {
    title,
    note: savedWork
      ? "Review what it saved before continuing, and decide the next step."
      : local && !local.published
        ? "Local evidence is retained, not saved as work. Review it before continuing."
        : "Review the recorded outcome and decide the next step.",
    checks,
    changedAttempts,
  };
}

/**
 * A turn outcome that only says how far its saved work was checked: shown as
 * a short line on that work's card rather than as a separate notice. Any
 * other outcome (stopped, blocked, needs input, unconfirmed) stays in view.
 */
export function cardStatus(
  view: ReturnType<typeof adaptivePresentation>,
): string | null {
  if (!view) return null;
  if (view.title === "Requested result verified")
    return `Independently checked. ${view.checks ?? ""} Later edits aren’t covered.`
      .replace(/\s+/g, " ")
      .trim();
  if (view.title === "Result saved — needs review")
    return `Not checked yet: look it over before relying on it.${
      view.checks ? ` ${view.checks}` : ""
    }`;
  return null;
}

/**
 * Whether an outcome only repeats what a turn's responsibility receipt says
 * (that it was recorded, and where it stands is on the hand-over itself).
 */
export function receiptSays(
  view: ReturnType<typeof adaptivePresentation>,
): boolean {
  return Boolean(view && /responsibilit(y|ies) recorded$/i.test(view.title));
}

/** Said beside the composer when the latest request stopped and is kept as it is. */
export const STOPPED_HINT =
  "The stopped request isn’t sent again. A new message starts a new request.";

/** Said beside the composer while the latest request's outcome is unknown. */
export const UNRESOLVED_HINT =
  "Whether your last request went through couldn’t be confirmed, so this conversation takes no new message until that’s resolved. Your draft is kept.";

/**
 * Whether the latest request's outcome couldn't be confirmed. The service
 * takes no new message until it's resolved (it answers "action_unresolved"),
 * so sending is held and nothing is replayed; re-reading is what's left.
 */
export function lastUnresolved(
  turns: readonly { state: TurnState; progress?: TurnProgress }[],
): boolean {
  const last = turns.at(-1);
  if (!last) return false;
  return (
    last.state === "outcome_unknown" ||
    last.progress?.provider_observation === "outcome_unknown"
  );
}

/**
 * Whether the latest request stopped in a way that is kept as it is: its
 * answer couldn't be used, or whether it went through is unknown. Such a
 * request is never resent, so the composer isn't a way to retry it.
 */
export function lastStopped(
  turns: readonly { state: TurnState; progress?: TurnProgress }[],
): boolean {
  const last = turns.at(-1);
  if (!last) return false;
  if (last.state === "outcome_unknown") return true;
  const seen = last.progress?.provider_observation;
  return seen === "invalid" || seen === "outcome_unknown";
}

/** What using a capability means, in plain words, by its catalog name. */
const CAPABILITY_WORDS: Record<string, string> = {
  inspect_json: "Looked inside the attached JSON file",
  search_work_context: "Searched your earlier work",
  read_saved_work: "Read your saved work",
  read_context: "Read the context it was given",
  load_skill: "Used a saved method",
  discover_capabilities: "Checked what it can do",
};

/**
 * How a step's use of a capability reads: plain words for known ones, and an
 * unfamiliar one as words rather than its internal identifier.
 */
export function capabilityUse(name: string): string {
  return (
    CAPABILITY_WORDS[name] ?? `Used ${name.replace(/[_.-]+/g, " ").trim()}`
  );
}

/**
 * A turn that stopped because what it tried was refused: its last step was
 * rejected and it then ran out of steps or was blocked. Not a budget stop.
 */
export function stoppedByRefusal(progress?: TurnProgress): boolean {
  const adaptive = progress?.adaptive;
  if (!adaptive) return false;
  return (
    (adaptive.outcome === "step_limit" || adaptive.outcome === "blocked") &&
    adaptive.steps?.at(-1)?.status === "rejected"
  );
}
