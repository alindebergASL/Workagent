import { describe, expect, it } from "vitest";
import type { TurnProgress } from "../src/lib/contract/natural";
import type { components } from "../../contracts/src/client";

type S = components["schemas"];
/** The pre-alpha runtime's progress, typed exactly (not the alpha union). */
type Adaptive = TurnProgress & { adaptive: S["AdaptiveExecution"] };
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  adaptivePresentation,
  stoppedByRefusal,
  lastStopped,
  lastUnresolved,
  modelExamples,
} from "../src/lib/adaptive-presentation";
import {
  TurnOutcome,
  TurnProgressDetails,
  replyText,
  TurnSummary,
} from "../src/components/TurnProgress";

const hash = "a".repeat(64);
function progress(): Adaptive {
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

function verified(): Adaptive {
  const p = progress();
  p.adaptive!.outcome = "completed";
  const step = p.adaptive!.steps![0]!;
  step.outcome = "completed";
  step.verification = {
    satisfied: true,
    model_tests_passed: false,
    basis: "independent_bounded",
    requested_goal_status: "satisfied",
    automatic: {
      checker_version: "csv-reconciliation-v1",
      scope: "bounded_csv_goal_only",
      limitations: ["Exact supplied rows only; no external truth."],
      recognized: true,
      passed: true,
      operation_hash: hash,
      staged_sha256: hash,
      row_count: 3,
      case_count: 0,
      failures: [],
    },
  };
  return p;
}

describe("honest adaptive presentation", () => {
  it("reports trusted complete bounded verification without implying approval", () => {
    const view = adaptivePresentation("replied", verified());
    expect(view?.title).toBe("Requested result verified");
    expect(view?.checks).toBe("Checked every supplied row (3).");
    expect(view?.note).toContain("still need your approval");
    expect(view?.note).toContain("later edits are not covered");
  });
  for (const field of ["passed", "recognized"] as const)
    it(`does not complete when automatic ${field} is false`, () => {
      const p = verified();
      p.adaptive!.steps![0]!.verification.automatic![field] = false;
      expect(adaptivePresentation("replied", p)?.title).not.toBe(
        "Requested result verified",
      );
    });
  it("does not complete unbound, unpublished, or uncertain output", () => {
    const p = verified();
    p.adaptive!.steps![0]!.verification.automatic!.operation_hash = "b".repeat(
      64,
    );
    expect(adaptivePresentation("replied", p)?.title).not.toBe(
      "Requested result verified",
    );
    const unpublished = verified();
    unpublished.retained_local_result!.published = false;
    expect(adaptivePresentation("replied", unpublished)?.title).not.toBe(
      "Requested result verified",
    );
    expect(
      adaptivePresentation("replied", {
        ...verified(),
        provider_observation: "outcome_unknown",
      })?.title,
    ).not.toBe("Requested result verified");
  });
  it("treats failed independent checks as obstacles even when model cases passed", () => {
    const p = verified();
    const first = p.adaptive!.steps![0]!;
    first.verification.automatic!.passed = false;
    first.verification.model_tests_passed = true;
    p.adaptive!.steps!.push({
      ...first,
      phase: "selection_2",
      operation_hash: "b".repeat(64),
    });
    p.adaptive!.outcome = "needs_validation";
    expect(adaptivePresentation("failed", p)?.changedAttempts).toBe(1);
  });
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
  for (const provider_observation of ["outcome_unknown", "invalid"] as const)
    it(`${provider_observation} explains the stop, not asking again as the way out`, () => {
      const v = adaptivePresentation("failed", {
        ...progress(),
        provider_observation,
      })!;
      const text = `${v.title} ${v.note}`;
      expect(text).not.toMatch(/ask(ing)? again|try again|retry it/i);
      expect(v.title).toMatch(/stopped/i);
      expect(v.note).toMatch(/won’t be (retried|sent again) on its own/);
      expect(v.note).toMatch(/your edits, is unchanged/);
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
  it("never says nothing was saved beside work the turn did save", () => {
    for (const outcome of [
      "step_limit",
      "budget_limit",
      "blocked",
      "waiting_for_user",
    ] as const) {
      const p = progress();
      p.adaptive!.outcome = outcome;
      p.retained_local_result!.published = false;
      const value = adaptivePresentation("failed", p, true);
      expect(value?.note).not.toMatch(/not saved/i);
      expect(value?.note).toMatch(/what it saved/i);
    }
  });
  it("says a stop after refused attempts was a refusal, not a limit", () => {
    for (const outcome of ["step_limit", "blocked"] as const) {
      const p = progress();
      p.adaptive!.outcome = outcome;
      p.retained_local_result!.published = false;
      p.adaptive!.steps!.push({
        ...p.adaptive!.steps![0]!,
        phase: "selection_2",
        status: "rejected",
        outcome,
      });
      const v = adaptivePresentation("failed", p)!;
      expect(v.title).toBe("Stopped: what it tried wasn’t possible here");
      expect(v.title + v.note).not.toMatch(/limit|budget/i);
      expect(v.note).toMatch(/nothing from (them|it) was applied/i);
      expect(stoppedByRefusal(p)).toBe(true);
      // With work it did save, the note points at that work instead.
      const saved = adaptivePresentation("failed", p, true)!;
      expect(saved.note).toMatch(/what it saved/i);
      expect(saved.note).not.toMatch(/not saved/i);
    }
    // A real budget stop stays a budget stop, refused last step or not.
    const b = progress();
    b.adaptive!.outcome = "budget_limit";
    b.adaptive!.steps![0]!.status = "rejected";
    expect(adaptivePresentation("failed", b)!.title).toBe(
      "Stopped at the budget limit",
    );
    expect(stoppedByRefusal(b)).toBe(false);
  });
  it("shows a refusal outcome rather than the generic run-stopped line", () => {
    const p = progress();
    p.adaptive!.outcome = "step_limit";
    p.adaptive!.steps![0]!.status = "rejected";
    const html = renderToStaticMarkup(
      createElement(TurnSummary, {
        state: "failed",
        progress: p,
        execution: {
          text: "Stopped: it isn’t allowed to go further with this right now. Your message is kept.",
          replaces: true,
        },
      }),
    );
    expect(html).toContain("Stopped: what it tried wasn’t possible here");
    expect(html).not.toContain("isn’t allowed to go further");
    // Any other stopped run keeps the service's own line.
    const q = progress();
    q.adaptive!.outcome = "budget_limit";
    expect(
      renderToStaticMarkup(
        createElement(TurnSummary, {
          state: "failed",
          progress: q,
          execution: { text: "Stopped by the service.", replaces: true },
        }),
      ),
    ).toContain("Stopped by the service.");
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
  it("orders every selection phase the service reports, past the fourth", () => {
    const p = progress();
    p.adaptive!.outcome = "continue";
    const last = p.adaptive!.steps![0]!;
    last.status = "rejected";
    last.phase = "selection_4";
    // Earlier or same phases aren't a retry after the fourth failed.
    p.response_steps = [
      { phase: "selection", state: "accepted" },
      { phase: "selection_4", state: "accepted" },
    ];
    expect(adaptivePresentation("responding", p)).toBeNull();
    // The service now allows up to eight: a fifth is the next attempt.
    p.response_steps.push({ phase: "selection_5", state: "accepted" });
    expect(adaptivePresentation("responding", p)?.title).toBe(
      "Trying another approach",
    );
  });
});

describe("model examples: none, passed or failed", () => {
  const check = (passed: boolean) => ({
    criterion: { kind: "wasm_return" },
    actual: "1",
    passed,
  });
  const steps = (p: Adaptive) => p.adaptive.steps!;
  function withExamples(
    model_tests_passed: boolean,
    checks?: ReturnType<typeof check>[],
  ) {
    const p = progress();
    steps(p)[0]!.verification.model_tests_passed = model_tests_passed;
    if (checks) steps(p)[0]!.verification.checks = checks;
    return p;
  }
  const details = (p: TurnProgress) =>
    renderToStaticMarkup(
      createElement(TurnProgressDetails, { progress: p }),
    ).replace(/<[^>]+>/g, " ");

  it("reads no examples as none, not as a failure", () => {
    const p = withExamples(false, []);
    expect(modelExamples(steps(p)[0]!.verification)).toEqual({ state: "none" });
    expect(details(p)).toContain("No model examples were run for this step.");
    expect(details(p)).not.toContain("did not pass");
    // A later changed step is not "a changed approach after a failed check".
    steps(p).push({
      ...steps(p)[0]!,
      phase: "selection_2",
      operation_hash: "b".repeat(64),
    });
    expect(adaptivePresentation("failed", p)?.changedAttempts).toBe(0);
    expect(adaptivePresentation("replied", p)?.checks).toBeNull();
  });
  it("says passing examples passed, with the count", () => {
    const p = withExamples(true, [check(true), check(true)]);
    expect(details(p)).toContain("Model examples passed (2 of 2).");
    expect(adaptivePresentation("replied", p)?.checks).toBe(
      "Model examples passed — not independent checks.",
    );
  });
  it("says failing examples failed, with the count, and counts the retry", () => {
    const p = withExamples(false, [check(true), check(false)]);
    expect(details(p)).toContain("Model examples did not pass (1 of 2).");
    steps(p).push({
      ...steps(p)[0]!,
      phase: "selection_2",
      operation_hash: "b".repeat(64),
    });
    expect(adaptivePresentation("failed", p)?.changedAttempts).toBe(1);
  });
});

describe("the trusted outcome under an answer", () => {
  const line = (state: Parameters<typeof TurnOutcome>[0]["state"]) =>
    renderToStaticMarkup(
      createElement(TurnOutcome, { state, progress: progress() }),
    ).replace(/<[^>]+>/g, "");
  it("shows the recorded state of a finished turn as its own line", () => {
    expect(line("replied")).toContain("Result saved — needs review.");
    expect(line("replied")).toContain("not yet verified");
  });
  it("says nothing for turns that haven't finished", () => {
    expect(line("responding")).toBe("");
    expect(line("failed")).toBe("");
  });
});

describe("general alpha: answers and retained explanations", () => {
  function alpha(
    outcome: S["AlphaExecution"]["outcome"],
    explanation: string | null,
  ): TurnProgress {
    return {
      provider_observation: "received",
      evidence_origin: "live_provider_receipt",
      retained_local_result: null,
      explanation: explanation
        ? {
            text: explanation,
            attempt_id: "attempt",
            phase: "final",
            authority: "model_explanation_not_verification",
            published: true,
          }
        : null,
      adaptive: {
        runtime_extension: "general-alpha-v1",
        capability: "adaptive-local-v1",
        cost_basis: "worst_case_reservations_not_billing",
        shared_cost_limit_usd: "20.00",
        shared_reserved_cost_usd: "0.1",
        max_steps: 4,
        outcome,
        steps: [
          {
            phase: "selection",
            status: "reply",
            outcome: outcome === "answered" ? "answered" : "needs_validation",
            capability_result: {
              capability: "guidance",
              version: "1",
              result: {},
            },
            verification: {
              satisfied: false,
              model_tests_passed: false,
              basis: "model_proposed",
              requested_goal_status: "needs_validation",
            },
          },
        ],
      },
    };
  }
  const text = (p: TurnProgress) =>
    renderToStaticMarkup(createElement(TurnProgressDetails, { progress: p }))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");

  it("keeps a direct answer exactly as recorded, even with an explanation", () => {
    const p = alpha("answered", "A different, secondary explanation.");
    expect(replyText("The exact selected answer.", p)).toEqual({
      body: "The exact selected answer.",
      explanation: false,
    });
    // Answered is a finished reply, not a verified or completed task.
    expect(adaptivePresentation("replied", p)).toBeNull();
    expect(text(p)).toContain("Answered directly.");
    expect(text(p)).toContain("not a verified result or a completed task");
    expect(text(p)).toContain("answer recorded");
    expect(text(p)).not.toMatch(/verified\b(?! result)/);
  });
  it("shows a work result's retained explanation first, keeping the message", () => {
    const recorded =
      "Here is the plan.\n\nExecution status: retained; needs validation.";
    const p = alpha("needs_validation", "Here is the plan.");
    expect(replyText(recorded, p)).toEqual({
      body: "Here is the plan.",
      explanation: true,
    });
    // Without a retained explanation the recorded message is the answer.
    expect(replyText(recorded, alpha("needs_validation", null))).toEqual({
      body: recorded,
      explanation: false,
    });
  });
  it("names a capability the step used, as a read, not a permission", () => {
    expect(text(alpha("answered", null))).toContain(
      "Used guidance (version 1). This reads information; it isn’t a permission or an action.",
    );
  });
  it("names known capabilities in plain words, never their internal names", () => {
    const using = (capability: string) => {
      const p = alpha("answered", null);
      (
        p.adaptive!.steps![0] as unknown as {
          capability_result: { capability: string };
        }
      ).capability_result.capability = capability;
      return text(p);
    };
    expect(using("inspect_json")).toContain(
      "Looked inside the attached JSON file (version 1).",
    );
    expect(using("search_work_context")).toContain(
      "Searched your earlier work (version 1).",
    );
    expect(using("read_saved_work")).toContain("Read your saved work");
    for (const name of [
      "inspect_json",
      "search_work_context",
      "read_saved_work",
    ])
      expect(using(name)).not.toContain(name);
    // An unfamiliar capability still reads as words, not an identifier.
    expect(using("summarise_notes")).toContain("Used summarise notes");
  });
});

describe("lastStopped", () => {
  it("is true only when the latest request stopped and is kept as it is", () => {
    expect(lastStopped([])).toBe(false);
    expect(lastStopped([{ state: "replied" }])).toBe(false);
    expect(lastStopped([{ state: "outcome_unknown" }])).toBe(true);
    for (const provider_observation of ["invalid", "outcome_unknown"] as const)
      expect(
        lastStopped([
          {
            state: "failed",
            progress: { ...progress(), provider_observation },
          },
        ]),
      ).toBe(true);
    // An earlier stop with a later answer is history, not the current state.
    expect(
      lastStopped([{ state: "outcome_unknown" }, { state: "replied" }]),
    ).toBe(false);
  });
});

describe("lastUnresolved", () => {
  it("is true only while the latest request's outcome is unknown", () => {
    expect(lastUnresolved([])).toBe(false);
    expect(lastUnresolved([{ state: "outcome_unknown" }])).toBe(true);
    expect(
      lastUnresolved([
        {
          state: "failed",
          progress: { ...progress(), provider_observation: "outcome_unknown" },
        },
      ]),
    ).toBe(true);
    // A known, unusable answer is stopped, not unresolved: a new message can
    // start a new request.
    expect(
      lastUnresolved([
        {
          state: "failed",
          progress: { ...progress(), provider_observation: "invalid" },
        },
      ]),
    ).toBe(false);
    expect(
      lastUnresolved([{ state: "outcome_unknown" }, { state: "replied" }]),
    ).toBe(false);
  });
});
