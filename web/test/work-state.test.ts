import { describe, expect, it } from "vitest";
import {
  completedSummary,
  phaseOf,
  shortTitle,
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
