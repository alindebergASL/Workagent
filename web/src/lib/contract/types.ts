/**
 * PROVISIONAL frontend contract.
 *
 * Hermes owns the canonical domain contract, OpenAPI export, generated client
 * and stateful mock. None of those existed on the remote when this file was
 * written, so these types mirror the names and semantics in Step 4
 * `CONTRACTS.md` closely enough that swapping to the generated client is a
 * mechanical change inside `src/lib/client`. Nothing here is an agreed schema.
 *
 * Rules carried over from CONTRACTS.md that the UI relies on:
 * - every mutation carries a stable command_id and, where state exists, an
 *   expected current revision/version;
 * - protected lookups fail with the indistinguishable
 *   `not_found_or_not_authorized`;
 * - a stale save or acceptance fails with `version_conflict` and the current
 *   revision plus the retained proposal are returned, never a merged body;
 * - a queued run (202) is not completed work.
 */

export const CONTRACT_SCHEMA_VERSION = "frontend-provisional-0.1";

export type ErrorCode =
  | "not_found_or_not_authorized"
  | "version_conflict"
  | "source_changed"
  | "source_unavailable"
  | "decision_required"
  | "decision_stale"
  | "budget_exhausted"
  | "connection_required"
  | "unsupported_operation"
  | "action_unresolved"
  | "command_conflict"
  // adapter-level codes (documented, not domain semantics)
  | "unauthenticated"
  | "invalid_request"
  | "validation_error"
  | "internal_error";

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    request_id: string;
    next_action?: string;
    details?: VersionConflictDetails | Record<string, unknown>;
  };
}

export interface VersionConflictDetails {
  current_revision_id: string;
  current_revision?: Revision;
  proposal?: Proposal;
}

export interface Workspace {
  id: string;
  name: string;
  kind: "personal" | "shared";
  scope_label: string;
  display_time_zone: string;
}

export interface SourceRef {
  id: string;
  title: string;
  version: string;
  surface: string;
  observed_at: string;
}

export interface SourceDetail extends SourceRef {
  excerpt: string | null;
  used_by_artifact_ids: string[];
  observed_dependencies?: {
    version: string;
    observed_at: string;
    artifact_ids: string[];
  }[];
  version_drift?: boolean;
}

export type AssignmentState =
  | "queued"
  | "working"
  | "ready_for_review"
  | "needs_input"
  | "finished"
  | "stopped"
  | "failed";

export type ArtifactKind = "analysis" | "plan" | "checklist";

export type ArtifactState = "queued" | "generating" | "ready" | "needs_review";

export interface ArtifactRef {
  id: string;
  title: string;
  kind: ArtifactKind;
  state: ArtifactState;
  accepted_revision_id: string | null;
  partial: boolean;
  updated_at: string;
}

export interface ActivityEvent {
  id: string;
  at: string;
  kind:
    | "created"
    | "stage"
    | "artifact"
    | "proposal"
    | "conflict"
    | "human"
    | "error";
  message: string;
}

export interface Recommendation {
  summary: string;
  evidence: string[];
  uncertainty: string[];
}

export interface AssignmentSummary {
  id: string;
  workspace_id: string;
  title: string;
  goal: string;
  state: AssignmentState;
  work_revision: number;
  stage: string | null;
  created_at: string;
  updated_at: string;
  observed_at: string;
  latest_result: string | null;
  next_step: string | null;
  needs_review_artifact_ids: string[];
  selected_source_count: number;
}

export interface Assignment extends AssignmentSummary {
  completion_criteria: string[];
  selected_source_refs: SourceRef[];
  recommendation: Recommendation | null;
  artifacts: ArtifactRef[];
  activity: ActivityEvent[];
  unresolved: string[];
  run: {
    run_id: string;
    state: "queued" | "running" | "waiting" | "done" | "failed";
    last_update_at: string;
  } | null;
}

export type BlockKind = "heading" | "paragraph" | "list_item" | "check_item";

export interface Block {
  id: string;
  kind: BlockKind;
  text: string;
  source_ids?: string[];
  checked?: boolean;
  /** Canonical kind retained through editing; display kind is presentation only. */
  backend_kind?: "heading" | "paragraph" | "checklist" | "protected_note";
}

export interface Author {
  kind: "human" | "agent";
  name: string;
}

export type RevisionStatus = "accepted" | "superseded";

export interface Revision {
  id: string;
  artifact_id: string;
  parent_revision_id: string | null;
  sequence: number;
  author: Author;
  created_at: string;
  status: RevisionStatus;
  body: Block[];
  body_hash: string;
  source_dependencies: { source_id: string; version: string }[];
  note: string | null;
}

export type ProposalStatus =
  | "generating"
  | "proposed"
  | "conflicted"
  | "accepted"
  | "declined"
  | "superseded";

export interface Proposal {
  id: string;
  artifact_id: string;
  base_revision_id: string;
  base_sequence: number;
  status: ProposalStatus;
  author: Author;
  reason: string;
  created_at: string;
  updated_at: string;
  body: Block[] | null;
  body_hash: string | null;
  conflict: { current_revision_id: string; observed_at: string } | null;
  resolved_by_revision_id: string | null;
}

export interface Artifact {
  id: string;
  assignment_id: string;
  workspace_id: string;
  title: string;
  kind: ArtifactKind;
  state: ArtifactState;
  partial: boolean;
  accepted_revision_id: string | null;
  accepted_revision: Revision | null;
  pending_proposal: Proposal | null;
  observed_at: string;
  source_refs: SourceRef[];
}

export interface ArtifactHistory {
  artifact_id: string;
  accepted_revision_id: string | null;
  revisions: Revision[];
  proposals: Proposal[];
}

// ---- commands ----

export interface CreateAssignmentCommand {
  command_id: string;
  goal: string;
  selected_source_refs: { id: string; version: string }[];
  completion_criteria: string[];
}

export interface CreateAssignmentResult {
  assignment_id: string;
  work_revision: number;
  run_id: string;
}

export interface SaveRevisionCommand {
  command_id: string;
  expected_current_revision_id: string;
  body: Block[];
  note?: string;
  resolves_proposal_id?: string;
}

export interface SaveRevisionResult {
  revision: Revision;
  artifact: Artifact;
}

export interface RequestRevisionCommand {
  command_id: string;
  base_revision_id: string;
  instruction: string;
}

export interface RequestRevisionResult {
  proposal_id: string;
  run_id: string;
}

export interface ProposalDecisionCommand {
  command_id: string;
  expected_current_revision_id: string;
}

export interface ProposalDecisionResult {
  proposal: Proposal;
  artifact: Artifact;
}

export interface ListResult<T> {
  items: T[];
  next_cursor: string | null;
  observed_at: string;
}
