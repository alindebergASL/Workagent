import { describe, expect, it } from "vitest";
import {
  completedSummary,
  phaseOf,
  workAttention,
  type WorkItem,
} from "../src/lib/work-state";
import type { Assignment, AssignmentSummary } from "../src/lib/contract/types";

const summary = (
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

const detail = (
  s: AssignmentSummary,
  changes: Partial<Assignment> = {},
): Assignment => ({
  ...s,
  completion_criteria: ["Plan and checklist"],
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
  ...changes,
});

const item = (s: AssignmentSummary, d: Assignment | null = null): WorkItem => ({
  summary: s,
  detail: d,
});

describe("work phases from persisted state", () => {
  it("drops in-progress framing once preparation completes", () => {
    expect(phaseOf(item(summary("working")))).toBe("working");
    expect(phaseOf(item(summary("ready_for_review")))).toBe("prepared");
    expect(phaseOf(item(summary("finished")))).toBe("completed");
    // Neither in-progress nor completed work is presented as a decision.
    expect(workAttention([item(summary("working"))])).toBeNull();
    expect(workAttention([item(summary("ready_for_review"))])?.action).toBe(
      "Open prepared work",
    );
  });

  it("finds pending decisions from the detail read, which the summary lacks", () => {
    const s = summary("ready_for_review", { id: "b" });
    const withReview = detail(s, { needs_review_artifact_ids: ["plan"] });
    expect(phaseOf(item(s))).toBe("prepared");
    expect(phaseOf(item(s, withReview))).toBe("decision");
    const attention = workAttention([
      item(summary("working")),
      item(s, withReview),
    ]);
    expect(attention?.href).toBe("/assignments/b/artifacts/plan");
    expect(attention?.title).toContain("working plan");
  });

  it("surfaces blocked work with its recorded reason, never a fabricated one", () => {
    const s = summary("needs_input", { id: "c" });
    const a = workAttention([
      item(s, detail(s, { unresolved: ["Source SG-F2 is unavailable."] })),
    ]);
    expect(a?.href).toBe("/assignments/c");
    expect(a?.body).toBe("Source SG-F2 is unavailable.");
  });

  it("describes completed work from saved artifacts only", () => {
    const s = summary("ready_for_review");
    expect(completedSummary(item(s, detail(s)))).toBe(
      "Prepared working plan and checklist.",
    );
    expect(completedSummary(item(s))).toBe("Saved results are available.");
  });
});
