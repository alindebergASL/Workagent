import { describe, expect, it } from "vitest";
import { workAttention } from "../src/lib/work-state";
import type { AssignmentSummary } from "../src/lib/contract/types";

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

describe("persisted work attention", () => {
  it("replaces in-progress framing when preparation completes", () => {
    expect(workAttention([item("working")])?.action).toBe("Inspect progress");
    expect(workAttention([item("ready_for_review")])?.action).toBe(
      "Open prepared work",
    );
    expect(workAttention([item("finished")])).toBeNull();
  });
  it("takes the person directly to the exact artifact awaiting a decision", () => {
    const attention = workAttention([
      item("working"),
      item("ready_for_review", {
        id: "b",
        needs_review_artifact_ids: ["proposal-artifact"],
      }),
    ]);
    expect(attention?.href).toBe("/assignments/b/artifacts/proposal-artifact");
    expect(workAttention([item("finished", { id: "b" })])).toBeNull();
  });
});
