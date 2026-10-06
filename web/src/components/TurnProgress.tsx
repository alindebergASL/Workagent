import type { TurnProgress } from "@/lib/contract/natural";

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
            {local.output?.value ? ` Value: ${local.output.value}.` : ""}
            {local.reason ? ` ${local.reason}` : ""}
          </li>
        ) : null}
      </ul>
    </details>
  );
}

/** A short tag for replies that aren't a live model's answer. */
export function replyTag(progress?: TurnProgress): string | null {
  if (progress?.evidence_origin === "synthetic_provider_receipt")
    return "Synthetic test reply";
  return null;
}
