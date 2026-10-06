import { describe, expect, it } from "vitest";
import {
  completedSummary,
  currentRun,
  decisionArtifactId,
  phaseOf,
  provenanceOf,
  shortTitle,
  statusOf,
  waitingSummary,
  workAttention,
} from "../src/lib/work-state";
import type { Assignment, AssignmentSummary } from "../src/lib/contract/types";

const item = (
  state: AssignmentSummary["state"],
  changes: Partial<AssignmentSummary> = {},
): AssignmentSummary => ({
  id: "assignment-a",
  workspace_id: "local-workspace",
  goal: "Improve intake",
  work_revision: 1,
  created_at: "2026-10-02T00:00:00Z",
  title: "Intake improvement",
  state,
  stage: null,
  updated_at: "2026-10-02T00:00:00Z",
  observed_at: "2026-10-02T00:00:00Z",
  latest_result: null,
  next_step: null,
  needs_review_artifact_ids: [],
  selected_source_count: 1,
  ...changes,
});

describe("work phases from the authoritative summary", () => {
  it("keeps prepared work distinct from approved work", () => {
    expect(phaseOf(item("ready_for_review"))).toBe("prepared");
    expect(phaseOf(item("finished"))).toBe("approved");
    expect(phaseOf(item("working"))).toBe("working");
    expect(phaseOf(item("queued"))).toBe("working");
  });

  it("never lets prepared work lose its review route", () => {
    const a = workAttention([item("ready_for_review", { id: "p" })]);
    expect(a?.action).toBe("Open prepared work");
    expect(a?.href).toBe("/assignments/p");
  });

  it("puts a waiting proposal ahead of prepared work and links the exact artifact", () => {
    const attention = workAttention([
      item("ready_for_review", { id: "p" }),
      item("ready_for_review", {
        id: "b",
        needs_review_artifact_ids: ["plan"],
      }),
    ]);
    expect(attention?.href).toBe("/assignments/b/artifacts/plan");
    expect(attention?.action).toBe("Review the change");
  });

  it("does not present in-progress or approved work as a decision", () => {
    expect(workAttention([item("working")])).toBeNull();
    expect(workAttention([item("finished")])).toBeNull();
  });

  it("surfaces blocked work with its recorded next step, never a fabricated one", () => {
    const a = workAttention([
      item("needs_input", {
        id: "c",
        next_step: "Source SG-F2 is unavailable.",
      }),
    ]);
    expect(a?.href).toBe("/assignments/c");
    expect(a?.body).toBe("Source SG-F2 is unavailable.");
  });

  it("describes completed work from saved artifacts when available", () => {
    const s = item("ready_for_review");
    const detail: Assignment = {
      ...s,
      completion_criteria: [],
      selected_source_refs: [],
      recommendation: null,
      artifacts: [
        {
          id: "plan",
          title: "Working plan",
          kind: "plan",
          state: "ready",
          accepted_revision_id: "r1",
          partial: false,
          updated_at: "",
        },
        {
          id: "check",
          title: "Checklist",
          kind: "checklist",
          state: "ready",
          accepted_revision_id: "r2",
          partial: false,
          updated_at: "",
        },
      ],
      activity: [],
      unresolved: [],
      run: null,
    };
    expect(completedSummary(detail)).toBe(
      "Prepared working plan and checklist.",
    );
    expect(
      completedSummary(item("finished", { latest_result: "Approved." })),
    ).toBe("Approved.");
  });

  it("titles work by the first sentence of the request", () => {
    expect(shortTitle("Start with my notes. Then more.")).toBe(
      "Start with my notes",
    );
  });
});

type Run = NonNullable<
  NonNullable<AssignmentSummary["responsibility"]>["runs"]
>[number];

const run = (state: Run["state"], changes: Partial<Run> = {}): Run => ({
  run_id: "run-2",
  state,
  continuation_available: false,
  outcome_gate: "unverified",
  safety_gate: "unverified",
  underlying_action_performed: false,
  ...changes,
});

const withRuns = (
  runs: Run[],
  latest = runs.at(-1)?.run_id,
  base: AssignmentSummary["state"] = "ready_for_review",
): AssignmentSummary =>
  item(base, {
    responsibility: {
      approved_change: "document_revision_only",
      underlying_action_performed: false,
      latest_run_id: latest,
      runs,
    },
  });

describe("responsibility outcome from the backend projection", () => {
  it("uses the run named by latest_run_id, not the last historical entry", () => {
    const a = withRuns(
      [
        run("readback_verified", { run_id: "run-1" }),
        run("decision_required", { run_id: "run-2" }),
      ],
      "run-1",
    );
    expect(currentRun(a)?.run_id).toBe("run-1");
    expect(phaseOf(a)).toBe("approved");
    expect(statusOf(a).label).toBe("Approved revision");
  });

  it("binds the decision to the exact question and artifact", () => {
    const a = withRuns([
      run("decision_required", {
        question: {
          prompt: "Should the owner check apply to all eight cases?",
          artifact_id: "plan-1",
          proposal_id: "proposal-1",
          base_revision_id: "rev-2",
        },
      }),
    ]);
    expect(statusOf(a).label).toBe("Decision needed");
    expect(decisionArtifactId(a)).toBe("plan-1");
    const card = workAttention([a]);
    expect(card?.body).toMatch(/Nothing is applied until you decide/);
    expect(card?.href).toBe("/assignments/assignment-a/artifacts/plan-1");
  });

  it("keeps a stale base a decision without claiming the proposal applies", () => {
    const a = withRuns([run("decision_stale")]);
    expect(phaseOf(a)).toBe("decision");
    expect(workAttention([a])?.title).toBe(
      "A proposal is based on an older version.",
    );
  });

  it("never presents an unknown provider outcome as done, failed or actionable", () => {
    const a = withRuns([
      run("outcome_unknown", {
        blocker: "provider_outcome_unknown",
        attempt_state: "outcome_unknown",
      }),
    ]);
    expect(phaseOf(a)).toBe("unknown");
    expect(statusOf(a).label).toBe("Waiting to confirm");
    expect(workAttention([a])).toBeNull();
  });

  it("names waiting blockers and refuses to call unverified work complete", () => {
    expect(
      statusOf(withRuns([run("waiting", { blocker: "consumer_unavailable" })]))
        .label,
    ).toBe("Agent not connected");
    expect(statusOf(withRuns([run("unverified")])).label).toBe("Not verified");
    // Every blocker the contract can project has a plain label (exhaustive map).
    expect(
      statusOf(
        withRuns([run("waiting", { blocker: "provider_result_rejected" })]),
      ).label,
    ).toBe("Reply not accepted");
    expect(
      waitingSummary(run("waiting", { blocker: "provider_response_pending" })),
    ).toMatch(/Nothing will be sent again/);
    expect(phaseOf(withRuns([run("prepared")]))).toBe("prepared");
    expect(statusOf(withRuns([run("approved")])).label).toBe(
      "Approved, since edited",
    );
  });

  it("labels provenance only from the attested evidence origin", () => {
    const exec = (
      evidence_origin:
        | "unverified"
        | "fixture"
        | "synthetic_provider_receipt"
        | "live_provider_receipt",
    ) => ({
      evidence_origin,
      mode: "managed" as const,
      profile: "openai-agents-v1" as const,
      model: "some-model",
      provider_observation: "received" as const,
    });
    // Managed mode, a model string and a received observation are not live evidence.
    expect(provenanceOf(exec("unverified"))).toEqual({
      label: "Run origin not verified",
      live: false,
    });
    expect(provenanceOf(exec("synthetic_provider_receipt"))?.live).toBe(false);
    expect(provenanceOf(exec("fixture"))?.label).toMatch(/fixture/);
    expect(provenanceOf(null)).toBeNull();
  });

  it("falls back to the summary when no projection exists", () => {
    expect(phaseOf(item("finished", { responsibility: null }))).toBe(
      "approved",
    );
    expect(
      phaseOf(withRuns([run("prepared")], "missing-run", "needs_input")),
    ).toBe("blocked");
  });
});

describe("paused work", () => {
  const base = {
    id: "a",
    workspace_id: "w",
    title: "t",
    goal: "g",
    state: "needs_input" as const,
    work_revision: 2,
    stage: null,
    created_at: "",
    updated_at: "",
    observed_at: "",
    latest_result: null,
    next_step: null,
    needs_review_artifact_ids: [] as string[],
    selected_source_count: 1,
  };
  it("reads as paused, never blocked or done", () => {
    const a = { ...base, lifecycle: "paused" as const };
    expect(phaseOf(a)).toBe("paused");
    expect(statusOf(a).label).toBe("Paused");
  });
  it("still surfaces a waiting decision", () => {
    expect(
      phaseOf({
        ...base,
        lifecycle: "paused" as const,
        needs_review_artifact_ids: ["x"],
      }),
    ).toBe("decision");
  });
  it("cancelled is stopped", () => {
    expect(phaseOf({ ...base, lifecycle: "cancelled" as const })).toBe(
      "stopped",
    );
  });
});
