import { describe, expect, it } from "vitest";
import type { TurnProgress } from "../src/lib/contract/natural";
import { adaptivePresentation } from "../src/lib/adaptive-presentation";

const hash = "a".repeat(64);
function progress(): TurnProgress {
  return {
    provider_observation: "received",
    retained_local_result: {
      status: "observed",
      published: true,
      binding: {
        attempt_id: "attempt",
        base_hash: null,
        selection_request_sha256: hash,
        selection_response_id: "response",
        decision_sha256: hash,
        operation_hash: hash,
      },
    },
    adaptive: {
      capability: "adaptive-local-v1",
      cost_basis: "worst_case_reservations_not_billing",
      shared_cost_limit_usd: "20.00",
      max_steps: 4,
      outcome: "needs_validation",
      shared_reserved_cost_usd: "0.4",
      steps: [
        {
          phase: "selection",
          status: "observed",
          operation_hash: hash,
          outcome: "needs_validation",
          verification: {
            satisfied: false,
            model_tests_passed: true,
            basis: "model_proposed",
            requested_goal_status: "needs_validation",
          },
        },
      ],
    },
  };
}

describe("honest adaptive presentation", () => {
  it("leaves legacy and missing progress unchanged", () => {
    expect(adaptivePresentation("failed")).toBeNull();
    expect(
      adaptivePresentation("failed", { provider_observation: "received" }),
    ).toBeNull();
  });
  it("separates a saved result from the requested goal", () => {
    const value = adaptivePresentation("failed", progress());
    expect(value?.title).toBe("Result saved — needs review");
    expect(value?.note).toContain("not yet verified");
    expect(value?.checks).toBe(
      "Model examples passed — not independent checks.",
    );
  });
  it("labels human checks only within their supplied scope", () => {
    const p = progress();
    const step = p.adaptive!.steps![0]!;
    step.verification.acceptance = {
      spec: {
        kind: "wasm_cases",
        entrypoint: "total",
        cases: [{ arguments: [3, 1250], expected: "3750" }],
      },
      checker_version: "human-checks-v1",
      scope: "supplied_checks_only",
      spec_sha256: hash,
      body_sha256: hash,
      operation_hash: hash,
      passed: true,
      checks: [{ criterion: {}, passed: true, actual: "3750" }],
    };
    expect(adaptivePresentation("failed", p)?.checks).toBe(
      "Supplied checks passed — those cases only.",
    );
    step.verification.acceptance!.operation_hash = "b".repeat(64);
    expect(adaptivePresentation("failed", p)?.checks).not.toContain(
      "Supplied checks passed",
    );
  });
  for (const state of ["cancelled", "outcome_unknown"] as const)
    it(`${state} takes precedence`, () => {
      expect(adaptivePresentation(state, progress())).toBeNull();
    });
  for (const provider_observation of ["outcome_unknown", "invalid"] as const)
    it(`${provider_observation} never looks successful`, () => {
      expect(
        adaptivePresentation("failed", { ...progress(), provider_observation })
          ?.title,
      ).not.toContain("saved");
    });
  for (const outcome of [
    "step_limit",
    "budget_limit",
    "blocked",
    "waiting_for_user",
  ] as const)
    it(`keeps ${outcome} work unpublished`, () => {
      const p = progress();
      p.adaptive!.outcome = outcome;
      p.retained_local_result!.published = false;
      const value = adaptivePresentation("failed", p);
      expect(value?.title).not.toContain("saved");
      expect(value?.note).toContain("not saved");
    });
  it("does not call several phases a changed approach", () => {
    const p = progress();
    p.adaptive!.steps!.push({
      ...p.adaptive!.steps![0]!,
      phase: "selection_2",
    });
    expect(adaptivePresentation("failed", p)?.changedAttempts).toBe(0);
  });
  it("counts a changed operation after a real failure", () => {
    const p = progress();
    const old = p.adaptive!.steps![0]!;
    old.status = "rejected";
    old.outcome = "continue";
    old.verification.model_tests_passed = false;
    p.adaptive!.steps!.push({
      ...old,
      phase: "selection_2",
      operation_hash: "b".repeat(64),
      status: "observed",
    });
    expect(adaptivePresentation("failed", p)?.changedAttempts).toBe(1);
  });
  it("only describes an in-flight retry after a later phase is accepted", () => {
    const p = progress();
    p.adaptive!.outcome = "continue";
    p.adaptive!.steps![0]!.status = "rejected";
    expect(adaptivePresentation("responding", p)).toBeNull();
    p.response_steps = [{ phase: "selection_2", state: "accepted" }];
    expect(adaptivePresentation("responding", p)?.title).toBe(
      "Trying another approach",
    );
  });
});
