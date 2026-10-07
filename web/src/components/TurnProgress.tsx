import type { TurnProgress } from "@/lib/contract/natural";
import type { TurnState } from "@/lib/contract/types";
import { adaptivePresentation } from "@/lib/adaptive-presentation";

export function TurnSummary({
  state,
  progress,
  fallback,
}: {
  state: TurnState;
  progress?: TurnProgress;
  fallback?: string;
}) {
  const view = adaptivePresentation(state, progress);
  if (!view) return <span>{fallback}</span>;
  return (
    <div className="stack-sm" data-testid="adaptive-summary">
      <span>{view.title}</span>
      <span className="hint">{view.note}</span>
      {view.checks ? <span className="hint">{view.checks}</span> : null}
      {view.changedAttempts > 0 ? (
        <span className="hint">
          Changed approach after a failed check{" "}
          {view.changedAttempts === 1
            ? "once"
            : `${view.changedAttempts} times`}
          .
        </span>
      ) : null}
    </div>
  );
}

const RESPONSE: Record<
  NonNullable<TurnProgress["provider_observation"]>,
  string
> = {
  not_observed: "No model response has been observed.",
  pending: "Waiting for the model’s response.",
  received: "The model’s response was received.",
  outcome_unknown: "Couldn’t confirm whether the model responded.",
  invalid: "The model’s response couldn’t be used.",
};
const ORIGIN: Record<NonNullable<TurnProgress["evidence_origin"]>, string> = {
  unverified: "Not yet confirmed.",
  synthetic_provider_receipt:
    "Recorded from a synthetic test receipt, not a live model.",
  live_provider_receipt: "Recorded from a live model response.",
  controlled_transport:
    "Recorded from a controlled test transport; no model was called.",
};

/** How a turn ran, one click away. Nothing here is work or a saved result. */
export function TurnProgressDetails({ progress }: { progress?: TurnProgress }) {
  if (!progress) return null;
  const local = progress.retained_local_result;
  return (
    <details className="ids-details">
      <summary>How this ran</summary>
      <ul className="ids">
        {progress.provider_observation ? (
          <li>{RESPONSE[progress.provider_observation]}</li>
        ) : null}
        {progress.evidence_origin ? (
          <li>{ORIGIN[progress.evidence_origin]}</li>
        ) : null}
        {local && !local.published ? (
          <li>
            {local.status === "rejected"
              ? "A local calculation was rejected."
              : "A local result was calculated but isn’t saved as work yet."}
            {local.output?.kind === "run_wasm"
              ? ` Value: ${local.output.value}.`
              : ""}
            {local.reason ? ` ${local.reason}` : ""}
          </li>
        ) : null}
      </ul>
      {progress.adaptive?.steps?.length ? (
        <ol>
          {progress.adaptive.steps.map((step, index) => (
            <li key={step.phase}>
              <p>
                Attempt {index + 1}:{" "}
                {step.status === "rejected"
                  ? "local execution rejected"
                  : step.status === "observed"
                    ? "local result observed"
                    : "response recorded"}
                .
              </p>
              {step.reason ? <p>{step.reason}</p> : null}
              <p>
                {step.verification.model_tests_passed
                  ? "Model examples passed."
                  : "Model examples did not pass."}{" "}
                These are not independent checks.
              </p>
              {step.verification.acceptance ? (
                <div>
                  <p>
                    Supplied checks{" "}
                    {step.verification.acceptance.passed
                      ? "passed"
                      : "did not pass"}
                    ; supplied cases only, not the whole request.
                  </p>
                  <ul>
                    {step.verification.acceptance.checks.map((check, i) => (
                      <li key={i}>
                        Check {i + 1}: {check.passed ? "passed" : "failed"}.
                        Observed: {JSON.stringify(check.actual ?? null)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </details>
  );
}

/** A short tag for replies that aren't a live model's answer. */
export function replyTag(origin: string): string | null {
  if (origin === "controlled_transport") return "Test reply";
  if (origin === "synthetic_provider_receipt") return "Synthetic test reply";
  return null;
}
