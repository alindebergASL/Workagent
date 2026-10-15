import type { TurnProgress } from "@/lib/contract/natural";
import Link from "next/link";
import type { ResponsibilityOrigin, TurnState } from "@/lib/contract/types";
import {
  adaptivePresentation,
  hasProductOutput,
  modelExamples,
} from "@/lib/adaptive-presentation";
import {
  recordedResponsibilities,
  type RecordingReceipt,
} from "@/lib/contract/natural";
import { RichText } from "@/components/RichText";
import { useScopedHref } from "@/lib/client/workspace";
import type { TurnExecution } from "@/lib/execution-view";

export function TurnSummary({
  state,
  progress,
  fallback,
  execution,
}: {
  state: TurnState;
  progress?: TurnProgress;
  fallback?: string;
  /** What the service says about this turn's run, while it's unanswered. */
  execution?: TurnExecution | null;
}) {
  const view = adaptivePresentation(state, progress);
  const said = execution ? (
    <span data-testid="turn-execution">{execution.text}</span>
  ) : null;
  if (execution?.replaces) return said;
  if (!view)
    return said ? (
      <span className="stack-sm">
        <span>{fallback}</span>
        <span className="hint">{said}</span>
      </span>
    ) : (
      <span>{fallback}</span>
    );
  return (
    <div className="stack-sm" data-testid="adaptive-summary">
      <span>{view.title}</span>
      {said ? <span className="hint">{said}</span> : null}
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
  recordedInDetails = false,
}: {
  text: string;
  progress?: TurnProgress;
  budget?: number;
  /** The recorded message is shown under the turn's Details instead. */
  recordedInDetails?: boolean;
}) {
  const reply = replyText(text, progress);
  return (
    <div className="msg-body">
      <span className="sr-only">Agent: </span>
      <RichText text={reply.body} budget={budget} />
      {reply.explanation && !recordedInDetails ? (
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
 * A continuation request the service made for a recorded hand-over. It is
 * never shown as the person's words, and it is a request, not a sign that a
 * model ran: what happened to it shows under it, by its own run.
 */
export function RuntimeRequest({
  text,
  origin,
}: {
  text: string;
  origin?: ResponsibilityOrigin | null;
}) {
  const inScope = useScopedHref();
  return (
    <div className="stack-xs runtime-request" data-testid="runtime-request">
      <p className="eyebrow-caps">Continuation request from a hand-over</p>
      <p>
        <span className="sr-only">Workagent’s continuation request: </span>
        {text}
      </p>
      {origin ? (
        <p className="small muted">
          Asked by Workagent for a recorded hand-over, not by you.{" "}
          <Link href={inScope(`/assignments/${origin.assignment_id}`)}>
            Open the hand-over
          </Link>
        </p>
      ) : (
        <p className="small muted">Asked by Workagent, not by you.</p>
      )}
      {origin ? (
        <details className="ids-details">
          <summary>Request details</summary>
          <p className="ids">
            Wake {origin.wake_id} · hand-over version {origin.work_version}
          </p>
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
export function TurnProgressDetails({
  progress,
  recorded,
  outcome,
}: {
  progress?: TurnProgress;
  /** The message exactly as recorded, when the answer shown is the retained explanation. */
  recorded?: string;
  /** A routine outcome note folded in here rather than shown inline. */
  outcome?: { title: string; note: string } | null;
}) {
  if (!progress) return null;
  const local = progress.retained_local_result;
  const showRecorded =
    recorded !== undefined && replyText(recorded, progress).explanation;
  return (
    <details className="ids-details">
      <summary>Details</summary>
      {outcome ? (
        <p className="small" data-testid="turn-outcome">
          <strong>{outcome.title}.</strong> {outcome.note}
        </p>
      ) : null}
      {showRecorded ? (
        <div className="stack-xs">
          <p className="small muted">
            The answer above is the model’s retained explanation, not a
            verification. The message exactly as recorded, with its status:
          </p>
          <RichText text={recorded} />
        </div>
      ) : null}
      <ul className="ids">
        {progress.provider_observation ? (
          <li>{RESPONSE[progress.provider_observation]}</li>
        ) : null}
        {progress.evidence_origin ? (
          <li>{ORIGIN[progress.evidence_origin]}</li>
        ) : null}
        {local && !local.published && hasProductOutput(local) ? (
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
      {recordedResponsibilities(progress).map((r) => (
        <p key={r.assignment_id} className="small">
          Recorded a responsibility (version {r.work_version}) as{" "}
          {RECORDED_STATE[r.state].toLowerCase()}. Outcome not verified; not
          admitted to run.
        </p>
      ))}
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
                {"mutation_result" in step && step.mutation_result
                  ? "responsibility recorded"
                  : step.status === "rejected"
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

const RECORDED_STATE: Record<RecordingReceipt["state"], string> = {
  active: "Held by Workagent",
  waiting_person: "Waiting for a person",
  waiting_event: "Waiting for something to change",
  blocked: "Blocked",
};

/**
 * The responsibilities a turn saved, as links to them. This is the service's
 * receipt from when they were recorded, not where they stand now: that is
 * read on the hand-over itself. Shown whether or not a final explanation
 * arrived.
 */
export function RecordingReceipts({
  progress,
  names,
}: {
  progress?: TurnProgress;
  /** Current goals, where they could be read; keyed by assignment. */
  names?: Record<string, string | undefined>;
}) {
  const inScope = useScopedHref();
  const recorded = recordedResponsibilities(progress);
  if (!recorded.length) return null;
  return (
    <ul className="recording-receipts stack-xs" data-testid="recording-receipt">
      {recorded.map((r) => (
        <li key={r.assignment_id} className="small">
          <span className="eyebrow-caps">Responsibility saved</span>{" "}
          <Link href={inScope(`/assignments/${r.assignment_id}`)}>
            {names?.[r.assignment_id] ?? "Open the saved responsibility"}
          </Link>
          <span className="muted">
            {" "}
            · Recorded as {RECORDED_STATE[r.state].toLowerCase()}. Open it for
            where it stands now.
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A short tag for replies that aren't a live model's answer. */
export function replyTag(origin: string): string | null {
  if (origin === "controlled_transport") return "Test reply";
  if (origin === "synthetic_provider_receipt") return "Synthetic test reply";
  return null;
}
