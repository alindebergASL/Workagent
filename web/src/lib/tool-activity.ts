/**
 * View mapping for the generated ToolAttemptView/ToolObservationV1 shapes.
 * Everything shown is what the adapter recorded; nothing here claims model
 * execution (verification_scope is adapter_execution_only).
 */
import type { components } from "../../../contracts/src/client";

type S = components["schemas"];
export type ToolAttemptView = S["ToolAttemptView"];
export type ToolObservationV1 = S["ToolObservationV1"];

export interface ToolAttemptRow {
  attemptId: string;
  capability: string;
  /** Short human state; outcome_unknown stays visibly unknown, never retried. */
  stateLabel: string;
  tone: "ok" | "failed" | "unknown" | "pending";
  started: string | null;
  ended: string | null;
  costLine: string | null;
  omissions: string[];
  truncated: boolean;
  errorLabel: string | null;
}

const STATE_LABELS: Record<ToolAttemptView["state"], string> = {
  reserved: "Reserved",
  dispatched: "Dispatched",
  observed: "Completed",
  failed: "Failed",
  cost_only: "Cost recorded, output not kept",
  outcome_unknown: "Outcome unknown — not retried automatically",
};

const ERROR_LABELS: Record<string, string> = {
  adapter_failed: "The tool itself failed",
  invalid_output: "The tool returned output that failed validation",
  authority_changed: "Authority changed before the call finished",
  outcome_unknown: "The outcome could not be confirmed",
};

export function toolAttemptRow(attempt: ToolAttemptView): ToolAttemptRow {
  const o = attempt.observation;
  return {
    attemptId: attempt.attempt_id,
    capability: attempt.capability_id,
    stateLabel: STATE_LABELS[attempt.state],
    tone:
      attempt.state === "observed"
        ? "ok"
        : attempt.state === "failed" || attempt.state === "cost_only"
          ? "failed"
          : attempt.state === "outcome_unknown"
            ? "unknown"
            : "pending",
    started: o?.started_at ?? null,
    ended: o?.ended_at ?? null,
    costLine: o ? costLine(o.cost) : null,
    omissions: o?.omissions ?? [],
    truncated: o?.truncated ?? false,
    errorLabel: o?.error ? (ERROR_LABELS[o.error.code] ?? o.error.code) : null,
  };
}

/** Reserved vs observed cost stay distinct; an unknown basis says so. */
export function costLine(cost: S["ToolCostV1"]): string {
  const unit = cost.unit === "call" ? "call" : "ms";
  const reserved = `reserved ${cost.reserved_cost_usd} USD (${cost.reserved_units} ${unit})`;
  if (cost.observed_cost_usd != null)
    return `${reserved}; observed ${cost.observed_cost_usd} USD (${cost.basis})`;
  if (cost.basis === "unknown") return `${reserved}; observed cost unknown`;
  return `${reserved}; basis ${cost.basis}`;
}
