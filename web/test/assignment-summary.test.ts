import { describe, expect, it } from "vitest";
import { assignmentSummary } from "../src/lib/client/assignment-summary";
import type { components } from "../../contracts/src/client";
import type { Artifact, Proposal } from "../src/lib/contract/types";
const assignment: components["schemas"]["Assignment"] = {
  id: "a",
  workspace_id: "w",
  owner_id: "human",
  goal: "Private plan",
  completion_criteria: ["Useful plan"],
  selected_source_refs: [],
  artifact_ids: ["plan"],
  run_ids: [],
  unresolved: [],
  state: "ready",
  work_version: 1,
  observed_at: "2026-10-02T00:00:00Z",
};
const artifact = (extra: Partial<Artifact> = {}): Artifact => ({
  id: "plan",
  assignment_id: "a",
  workspace_id: "w",
  title: "Plan",
  kind: "plan",
  state: "ready",
  partial: false,
  accepted_revision_id: "r1",
  approved_revision_id: null,
  accepted_revision: null,
  pending_proposal: null,
  observed_at: assignment.observed_at!,
  source_refs: [],
  ...extra,
});
const pending = (status: Proposal["status"]): Proposal => ({
  id: "p",
  artifact_id: "plan",
  base_revision_id: "r1",
  base_sequence: 1,
  status,
  author: { kind: "agent", name: "Workagent" },
  reason: "Change",
  created_at: assignment.observed_at!,
  updated_at: assignment.observed_at!,
  body: null,
  body_hash: null,
  conflict: null,
  resolved_by_revision_id: null,
});
describe("shared authoritative read-model projection", () => {
  it("prepared output and ordinary human save are not approval", () => {
    expect(assignmentSummary(assignment, [artifact()]).state).toBe(
      "ready_for_review",
    );
  });
  it("current accepted proposal is an approved revision, not an external effect", () => {
    const s = assignmentSummary(assignment, [
      artifact({ approved_revision_id: "r1" }),
    ]);
    expect(s.state).toBe("finished");
    expect(s.latest_result).toContain("No external action");
    expect(s.needs_review_artifact_ids).toEqual([]);
  });
  it("pending review supersedes an earlier approval", () => {
    const s = assignmentSummary(assignment, [
      artifact({
        approved_revision_id: "r1",
        pending_proposal: pending("conflicted"),
      }),
    ]);
    expect(s.state).toBe("ready_for_review");
    expect(s.needs_review_artifact_ids).toEqual(["plan"]);
  });
  it("new work and partial work cannot be presented as completed", () => {
    for (const [state, want] of [
      ["queued", "queued"],
      ["running", "working"],
      ["partial", "needs_input"],
      ["paused", "needs_input"],
      ["cancelled", "stopped"],
    ] as const)
      expect(
        assignmentSummary({ ...assignment, state }, [
          artifact({ approved_revision_id: "r1" }),
        ]).state,
      ).toBe(want);
  });
  it("projects pause and cancel as steering state the person controls", () => {
    for (const [state, want] of [
      ["running", "active"],
      ["paused", "paused"],
      ["cancelled", "cancelled"],
    ] as const)
      expect(assignmentSummary({ ...assignment, state }, []).lifecycle).toBe(
        want,
      );
  });
  it("a later saved revision invalidates earlier approval attribution", () => {
    expect(
      assignmentSummary(assignment, [
        artifact({ approved_revision_id: "r1", accepted_revision_id: "r2" }),
      ]).state,
    ).toBe("ready_for_review");
  });
  it("legacy ready rows with actual active revision receipts remain working", () => {
    expect(
      assignmentSummary(assignment, [
        artifact({
          pending_proposal: pending("generating"),
          approved_revision_id: "r1",
        }),
      ]).state,
    ).toBe("working");
  });
});
