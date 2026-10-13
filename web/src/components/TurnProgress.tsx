import type { TurnProgress } from "@/lib/contract/natural";
import type { TurnState } from "@/lib/contract/types";
import {
  adaptivePresentation,
  modelExamples,
} from "@/lib/adaptive-presentation";
import { RichText } from "@/components/RichText";

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

/**
 * What to show as an agent message's answer. A direct answer is the recorded
 * message, exactly. For a work result, the service retains the model's final
 * explanation on its own; that is the answer, and the recorded message (which
 * also carries the execution status) stays one click away. Nothing is parsed
 * or stripped from the message itself.
 */
export function replyText(
  text: string,
  progress?: TurnProgress,
): { body: string; explanation: boolean } {
  const e = progress?.explanation;
  if (!e || progress?.adaptive?.outcome === "answered" || e.text === text)
    return { body: text, explanation: false };
  return { body: e.text, explanation: true };
}

/** An agent message: the answer first, the recorded message inspectable. */
export function AgentReply({
  text,
  progress,
  budget,
}: {
  text: string;
  progress?: TurnProgress;
  budget?: number;
}) {
  const reply = replyText(text, progress);
  return (
    <div className="msg-body">
      <span className="sr-only">Agent: </span>
      <RichText text={reply.body} budget={budget} />
      {reply.explanation ? (
        <details className="ids-details">
          <summary>The message as recorded</summary>
          <p className="small muted">
            Above is the model’s retained explanation, not a verification. This
            is the message exactly as it was recorded, with its status.
          </p>
          <RichText text={text} />
        </details>
      ) : null}
    </div>
  );
}

/**
 * The trusted state of a finished turn, as one quiet line under the answer:
 * what the service recorded (needs review, verified, stopped), never the
 * model's own claim. The answer itself stays first and untouched.
 */
export function TurnOutcome({
  state,
  progress,
}: {
  state: TurnState;
  progress?: TurnProgress;
}) {
  if (state !== "replied") return null;
  const view = adaptivePresentation(state, progress);
  if (!view) return null;
  return (
    <p className="msg-outcome small" data-testid="turn-outcome">
      <strong>{view.title}.</strong> {view.note}
      {view.checks ? ` ${view.checks}` : ""}
    </p>
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

/** The model's own examples for one step: none, passed or failed. */
function modelExamplesText(v: Parameters<typeof modelExamples>[0]): string {
  const r = modelExamples(v);
  if (r.state === "none") return "No model examples were run for this step.";
  const count = r.total ? ` (${r.passed} of ${r.total})` : "";
  return r.state === "passed"
    ? `Model examples passed${count}. These are not independent checks.`
    : `Model examples did not pass${count}. These are not independent checks.`;
}

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
      {progress.adaptive?.outcome === "answered" ? (
        <p className="small">
          Answered directly. This is a reply, not a verified result or a
          completed task.
        </p>
      ) : null}
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
                    : step.outcome === "answered"
                      ? "answer recorded"
                      : "response recorded"}
                .
              </p>
              {step.reason ? <p>{step.reason}</p> : null}
              {"capability_result" in step &&
              typeof step.capability_result?.capability === "string" ? (
                <p>
                  Used {step.capability_result.capability}
                  {typeof step.capability_result.version === "string"
                    ? ` (version ${step.capability_result.version})`
                    : ""}
                  . This reads information; it isn’t a permission or an action.
                </p>
              ) : null}
              <p data-testid="model-examples">
                {modelExamplesText(step.verification)}
              </p>
              {step.verification.automatic?.recognized ? (
                <div>
                  <p>
                    Independent bounded check:{" "}
                    {step.verification.automatic.passed
                      ? "passed"
                      : "not passed"}
                    . This is verification, not your approval.
                  </p>
                  <ul>
                    {step.verification.automatic.limitations.map(
                      (limitation, i) => (
                        <li key={i}>{limitation}</li>
                      ),
                    )}
                  </ul>
                </div>
              ) : null}
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
