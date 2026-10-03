import type { components } from "../../../../contracts/src/client";
import type {
  Artifact,
  AssignmentSummary,
  AssignmentState,
  Lifecycle,
} from "@/lib/contract/types";

/** Read model only: ready computation is not human approval or an external effect. */
export function assignmentSummary(
  a: components["schemas"]["Assignment"],
  artifacts: Artifact[],
): AssignmentSummary {
  const pending = artifacts
    .filter((x) =>
      ["proposed", "conflicted"].includes(x.pending_proposal?.status ?? ""),
    )
    .map((x) => x.id);
  const active = artifacts.some(
    (x) => x.pending_proposal?.status === "generating",
  );
  const approved = artifacts.some(
    (x) =>
      x.approved_revision_id &&
      x.approved_revision_id === x.accepted_revision_id,
  );
  const state: AssignmentState =
    a.state === "cancelled"
      ? "stopped"
      : a.state === "paused" || a.state === "partial"
        ? "needs_input"
        : a.state === "running"
          ? "working"
          : a.state === "queued"
            ? "queued"
            : active
              ? "working"
              : pending.length
                ? "ready_for_review"
                : approved
                  ? "finished"
                  : "ready_for_review";
  const updated =
    [
      a.observed_at,
      ...artifacts.map((x) => x.accepted_revision?.created_at ?? ""),
    ]
      .filter(Boolean)
      .sort()
      .at(-1) ?? "";
  return {
    id: a.id,
    workspace_id: a.workspace_id,
    title: a.goal,
    goal: a.goal,
    state,
    work_revision: a.work_version ?? 1,
    created_at: a.observed_at ?? "",
    updated_at: updated,
    observed_at: a.observed_at ?? "",
    stage:
      state === "queued"
        ? "Queued for local fixture work"
        : state === "working"
          ? "Preparing private artifacts"
          : null,
    latest_result:
      state === "finished"
        ? "Your approved revision is saved. No external action was taken."
        : (a.artifact_ids ?? []).length
          ? "Saved private artifacts are available"
          : null,
    next_step:
      a.unresolved?.[0] ??
      (pending.length
        ? "Review the proposed revision"
        : state === "finished"
          ? "Open the approved work or delegate a next step"
          : state === "queued" || state === "working"
            ? "Wait for the local worker"
            : (a.artifact_ids ?? []).length
              ? "Review the plan and checklist"
              : null),
    needs_review_artifact_ids: pending,
    selected_source_count: a.selected_source_refs.length,
    responsibility: a.responsibility ?? null,
    lifecycle: lifecycleOf(a.state),
  };
}

export function lifecycleOf(
  state: components["schemas"]["Assignment"]["state"],
): Lifecycle {
  return state === "paused"
    ? "paused"
    : state === "cancelled"
      ? "cancelled"
      : "active";
}
