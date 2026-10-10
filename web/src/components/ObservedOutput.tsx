import { currentObservation, type S } from "@/lib/client/products";
import { ROUNDING_LABEL } from "@/lib/product-summary";

/** Which saved state an observation belongs to, in plain words. */
function bindingText(read: S["ObservationReadback"], verified: boolean) {
  if (verified) return "Checked against the current saved version.";
  if (read.binding_state === "pending_proposal")
    return "Checked against the proposed version, not your saved one.";
  if (!read.current_scope)
    return "Your access or context has changed since this was checked.";
  return "Checked against an earlier version.";
}

/**
 * One recorded execution and exactly what it was bound to. The plain summary
 * comes first; the full record (hashes, engine, limits) stays available.
 */
export function ObservedOutput({
  artifact,
  read,
  stale,
}: {
  artifact: S["Artifact"];
  read: S["ObservationReadback"];
  stale: boolean;
}) {
  const output = read.observation.output;
  const verified = currentObservation(artifact, read) && !stale;
  return (
    <section className="observed stack-sm">
      <p className="small">{bindingText(read, verified)}</p>
      {output.kind === "artifact_draft" ? (
        <p>
          Saved as a draft. Only its shape was checked; nothing in it was run or
          verified.
        </p>
      ) : output.kind === "run_wasm" ? (
        <p>
          Returned <strong data-testid="observed-return">{output.value}</strong>{" "}
          for inputs {output.arguments.join(", ")}.
        </p>
      ) : (
        <>
          <p>
            Reported {output.reported_sum} · calculated{" "}
            <strong>{output.expected_sum}</strong>
            {output.discrepancies.length
              ? ` · rows off: ${output.discrepancies.join(", ")}`
              : " · every row matches"}
          </p>
          <p className="small muted">
            {output.formula}. {ROUNDING_LABEL[output.rounding]}.
          </p>
        </>
      )}
      <details className="ids-details">
        <summary>Exact record</summary>
        <pre className="product-code">{JSON.stringify(read, null, 2)}</pre>
      </details>
    </section>
  );
}
