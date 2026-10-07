import type { TurnProgress } from "./contract/natural";
import type { TurnState } from "./contract/types";

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
    s.verification.acceptance?.passed === false ||
    s.verification.model_tests_passed === false;
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
      : bound && last?.verification.model_tests_passed
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
