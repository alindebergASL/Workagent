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
export function adaptivePresentation(
  state: TurnState,
  progress?: TurnProgress,
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
      title:
        progress.provider_observation === "invalid"
          ? "The model response could not be used"
          : "Couldn’t confirm the model response",
      note: "Any local work is retained. Inspect it before asking again; this is not a confirmed completion.",
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
      note: "Saved as a hand-over Workagent holds. Its outcome isn’t verified, and nothing runs for it yet.",
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
    const order = ["selection", "selection_2", "selection_3", "selection_4"];
    const nextObserved =
      last &&
      failed(last) &&
      progress.response_steps?.some(
        (s) =>
          order.indexOf(s.phase) > order.indexOf(last.phase) &&
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
      note: "The recorded result passed an independent check within the stated scope. Proposed changes still need your approval; later edits are not covered.",
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
      note: "Your request is not yet verified. Proposed changes still need your approval.",
      checks,
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
    note:
      local && !local.published
        ? "Local evidence is retained, not saved as work. Review it before continuing."
        : "Review the recorded outcome and decide the next step.",
    checks,
    changedAttempts,
  };
}
