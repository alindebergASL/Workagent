import { currentObservation, type S } from "@/lib/client/products";

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
    <section className="card card-quiet">
      <h2>
        {verified ? "Saved revision observed output" : "Latest local output"}
      </h2>
      <p className="hint">
        {read.binding_state.replaceAll("_", " ")} ·{" "}
        {read.current_scope ? "scope current" : "scope changed"}
        {verified ? "" : " · not current verification"}
      </p>
      {output.kind === "run_wasm" ? (
        <>
          <p>
            Observed return:{" "}
            <strong data-testid="observed-return">{output.value}</strong>
          </p>
          <p>
            Inputs: {JSON.stringify(output.arguments)} · {output.engine}
          </p>
        </>
      ) : (
        <>
          <p>
            Reported: {output.reported_sum} · Calculated:{" "}
            <strong>{output.expected_sum}</strong>
          </p>
          <p>{output.formula}</p>
          <p>
            Rounding: {output.rounding}; discrepancies:{" "}
            {output.discrepancies.join(", ") || "none"}
          </p>
        </>
      )}
      <details>
        <summary>Execution binding and provenance</summary>
        <pre className="product-code">{JSON.stringify(read, null, 2)}</pre>
      </details>
    </section>
  );
}
