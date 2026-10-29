import { describe, expect, it } from "vitest";
import {
  costLine,
  toolAttemptRow,
  type ToolAttemptView,
  type ToolObservationV1,
} from "@/lib/tool-activity";

const cost = (over: Partial<ToolObservationV1["cost"]> = {}) => ({
  basis: "provider_reported" as const,
  billed_cost_usd: null,
  category: "search" as const,
  cpu_ms: 10,
  elapsed_ms: 120,
  observed_cost_usd: "0.0021",
  observed_units: 1,
  reserved_cost_usd: "0.0100",
  reserved_units: 1,
  unit: "call" as const,
  ...over,
});

const observation = (
  over: Partial<ToolObservationV1> = {},
): ToolObservationV1 => ({
  attempt_id: "a1",
  call_id: "c1",
  capability_id: "research.search",
  capability_version: "1",
  cost: cost(),
  ended_at: "2026-10-28T10:00:01Z",
  error: null,
  execution_profile: "default",
  implementation_sha256: "0".repeat(64),
  input_refs: [],
  omissions: [],
  output: null,
  output_refs: [],
  output_sha256: null,
  privacy_label: "workspace_private",
  run_id: "r1",
  schema_version: "tool-observation/v1",
  source_refs: [],
  started_at: "2026-10-28T10:00:00Z",
  status: "observed",
  truncated: false,
  verification_scope: "adapter_execution_only",
  ...over,
});

const attempt = (over: Partial<ToolAttemptView> = {}): ToolAttemptView => ({
  attempt_id: "a1",
  call_id: "c1",
  capability_id: "research.search",
  observation: observation(),
  run_id: "r1",
  state: "observed",
  ...over,
});

describe("tool attempt rows", () => {
  it("shows exact state, cost and timing for a completed call", () => {
    const row = toolAttemptRow(attempt());
    expect(row.stateLabel).toBe("Receipt recorded");
    expect(row.tone).toBe("ok");
    expect(row.costLine).toContain("reserved 0.0100 USD");
    expect(row.costLine).toContain("observed 0.0021 USD (provider_reported)");
    expect(row.started).toBe("2026-10-28T10:00:00Z");
  });

  it("keeps an unknown outcome visibly unknown instead of pretending", () => {
    const row = toolAttemptRow(
      attempt({
        state: "outcome_unknown",
        observation: observation({
          status: "outcome_unknown",
          error: { code: "outcome_unknown", retryable: false },
          cost: cost({ basis: "unknown", observed_cost_usd: null }),
        }),
      }),
    );
    expect(row.stateLabel).toBe("Outcome unknown — not retried automatically");
    expect(row.tone).toBe("unknown");
    expect(row.errorLabel).toBe("The outcome could not be confirmed");
    expect(row.costLine).toContain("observed cost unknown");
  });

  it("surfaces omissions and truncation honestly", () => {
    const row = toolAttemptRow(
      attempt({
        observation: observation({
          omissions: ["response body over the retained limit"],
          truncated: true,
        }),
      }),
    );
    expect(row.omissions).toEqual(["response body over the retained limit"]);
    expect(row.truncated).toBe(true);
  });

  it("renders a pre-dispatch attempt without inventing an observation", () => {
    const row = toolAttemptRow(
      attempt({ state: "reserved", observation: null }),
    );
    expect(row.stateLabel).toBe("Reserved");
    expect(row.costLine).toBeNull();
    expect(row.started).toBeNull();
  });

  it("names the reserved basis when nothing was observed", () => {
    expect(
      costLine(cost({ observed_cost_usd: null, basis: "estimated" })),
    ).toBe("reserved 0.0100 USD (1 call); basis estimated");
  });
});
