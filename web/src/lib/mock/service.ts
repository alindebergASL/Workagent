/**
 * MOCK domain service. Implements the provisional contract semantics the UI
 * depends on: server-resolved workspace scope, indistinguishable
 * not_found_or_not_authorized, scoped command IDs with command_conflict,
 * compare-and-swap saves with version_conflict, proposals that keep both
 * bodies, time-based run progression and file-backed persistence across
 * process restarts. It is a frontend stand-in, not Hermes's backend.
 */
import { createHash } from "node:crypto";
import type {
  ActivityEvent,
  Artifact,
  ArtifactHistory,
  ArtifactKind,
  ArtifactRef,
  Assignment,
  AssignmentSummary,
  Block,
  ControlAssignmentCommand,
  ControlAssignmentResult,
  CreateAssignmentCommand,
  CreateAssignmentResult,
  ErrorCode,
  ListResult,
  Proposal,
  ProposalDecisionCommand,
  ProposalDecisionResult,
  RequestRevisionCommand,
  RequestRevisionResult,
  Revision,
  SaveRevisionCommand,
  SaveRevisionResult,
  SourceDetail,
  SourceRef,
  Workspace,
} from "@/lib/contract/types";
import { fixtureSources } from "./fixture";
import {
  loadState,
  nextId,
  resetState,
  saveState,
  type MockState,
} from "./store";
import {
  bodyHash,
  buildAnalysisBody,
  buildChecklistBody,
  buildPlanBody,
  buildProposalBody,
  buildRecommendation,
} from "./worker";

export class MockError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly nextAction?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const STAGE_MS = Number(process.env["WORKAGENT_MOCK_STAGE_MS"] ?? 2500);
const PROPOSAL_MS = Number(process.env["WORKAGENT_MOCK_PROPOSAL_MS"] ?? 20000);

const STAGES = [
  "Reading selected sources",
  "Analyzing the intake log",
  "Drafting the plan and checklist",
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function notFound(): MockError {
  return new MockError(
    "not_found_or_not_authorized",
    404,
    "The requested item was not found or you are not authorized to see it.",
    "Return to Work Home.",
  );
}

// ---------- scope ----------

function ensureBootstrapped(state: MockState, principal: string): void {
  if (state.memberships.some((m) => m.principal === principal)) return;
  const id = `ws_${principal}`;
  const name = principal === "alex" ? "Alex Moreno" : principal;
  state.workspaces.push({
    id,
    name: `${name}’s workspace`,
    kind: "personal",
    scope_label: "Private",
    display_time_zone: "UTC",
  });
  state.memberships.push({ principal, workspace_id: id });
  const observed = nowIso();
  for (const s of fixtureSources(observed)) state.sources[`${id}:${s.id}`] = s;
  saveState(state);
}

export function resolvePrincipal(headerValue: string | null): string {
  const p = (headerValue ?? "").trim();
  if (!p)
    throw new MockError(
      "unauthenticated",
      401,
      "No authenticated principal.",
      "Sign in.",
    );
  return p;
}

function scope(
  state: MockState,
  principal: string,
  workspaceId: string,
): Workspace {
  ensureBootstrapped(state, principal);
  const member = state.memberships.some(
    (m) => m.principal === principal && m.workspace_id === workspaceId,
  );
  const ws = state.workspaces.find((w) => w.id === workspaceId);
  if (!member || !ws) throw notFound();
  return ws;
}

export function listWorkspaces(principal: string): ListResult<Workspace> {
  const state = loadState();
  ensureBootstrapped(state, principal);
  const ids = new Set(
    state.memberships
      .filter((m) => m.principal === principal)
      .map((m) => m.workspace_id),
  );
  return {
    items: state.workspaces.filter((w) => ids.has(w.id)),
    next_cursor: null,
    observed_at: nowIso(),
  };
}

export function listSources(
  principal: string,
  workspaceId: string,
): ListResult<SourceDetail> {
  const state = loadState();
  scope(state, principal, workspaceId);
  const items = Object.entries(state.sources)
    .filter(([k]) => k.startsWith(`${workspaceId}:`))
    .map(([, v]) => v);
  return { items, next_cursor: null, observed_at: nowIso() };
}

// ---------- commands ----------

function withCommand<T>(
  state: MockState,
  scopeKey: string,
  commandId: string,
  payload: unknown,
  run: () => { status: number; body: T },
): { status: number; body: T; replayed: boolean } {
  const key = `${scopeKey}:${commandId}`;
  const payloadHash = hashPayload(payload);
  const existing = state.commands[key];
  if (existing) {
    if (existing.payload_hash !== payloadHash) {
      throw new MockError(
        "command_conflict",
        409,
        "This command ID was already used with a different payload.",
        "Reload and inspect the recorded result before retrying.",
      );
    }
    return {
      status: existing.status,
      body: existing.body as T,
      replayed: true,
    };
  }
  const result = run();
  state.commands[key] = {
    command_id: commandId,
    payload_hash: payloadHash,
    status: result.status,
    body: result.body,
  };
  return { ...result, replayed: false };
}

// ---------- assignments ----------

function summaryOf(a: Assignment): AssignmentSummary {
  const {
    completion_criteria: _c,
    selected_source_refs: _s,
    recommendation: _r,
    artifacts: _a,
    activity: _ac,
    unresolved: _u,
    run: _run,
    ...summary
  } = a;
  void _c;
  void _s;
  void _r;
  void _a;
  void _ac;
  void _u;
  void _run;
  return summary;
}

function titleFromGoal(goal: string): string {
  const first = goal.split(/[.!?\n]/)[0]?.trim() ?? goal.trim();
  const t = first.length > 64 ? `${first.slice(0, 61).trimEnd()}…` : first;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function pushActivity(
  a: Assignment,
  state: MockState,
  kind: ActivityEvent["kind"],
  message: string,
  at = nowIso(),
): void {
  a.activity.push({ id: nextId(state, "ev"), at, kind, message });
  a.updated_at = at;
}

export function createAssignment(
  principal: string,
  workspaceId: string,
  cmd: CreateAssignmentCommand,
): { status: number; body: CreateAssignmentResult } {
  const state = loadState();
  scope(state, principal, workspaceId);
  const { command_id, ...payload } = cmd;
  const result = withCommand(
    state,
    `${workspaceId}:create_assignment`,
    command_id,
    payload,
    () => {
      if (!payload.goal || !payload.goal.trim()) {
        throw new MockError(
          "invalid_request",
          422,
          "A request is required.",
          "Describe what you would like to finish.",
        );
      }
      const refs: SourceRef[] = payload.selected_source_refs.map((r) => {
        const src = state.sources[`${workspaceId}:${r.id}`];
        if (!src || src.version !== r.version) {
          throw new MockError(
            "source_unavailable",
            409,
            `Source ${r.id} is not available at the requested version.`,
            "Re-select sources and try again.",
          );
        }
        return {
          id: src.id,
          title: src.title,
          version: src.version,
          surface: src.surface,
          observed_at: src.observed_at,
        };
      });
      if (refs.length === 0) {
        throw new MockError(
          "invalid_request",
          422,
          "Select at least one source.",
          "Choose the records this work should use.",
        );
      }
      const id = nextId(state, "asg");
      const runId = nextId(state, "run");
      const at = nowIso();
      const a: Assignment = {
        id,
        workspace_id: workspaceId,
        title: titleFromGoal(payload.goal),
        goal: payload.goal.trim(),
        state: "queued",
        work_revision: 1,
        stage: null,
        created_at: at,
        updated_at: at,
        observed_at: at,
        latest_result: null,
        next_step: "Waiting to start.",
        needs_review_artifact_ids: [],
        selected_source_count: refs.length,
        completion_criteria: payload.completion_criteria.length
          ? payload.completion_criteria
          : [
              "A private recommendation with its evidence.",
              "An editable working plan.",
              "A reusable checklist.",
            ],
        selected_source_refs: refs,
        recommendation: null,
        artifacts: [],
        activity: [],
        unresolved: [],
        run: { run_id: runId, state: "queued", last_update_at: at },
      };
      pushActivity(
        a,
        state,
        "created",
        `Assignment created from ${refs.length} selected source${refs.length === 1 ? "" : "s"}.`,
        at,
      );
      state.assignments[id] = a;
      state.runs[runId] = {
        assignment_id: id,
        started_at: at,
        materialized_stage: 0,
        failed: false,
      };
      return {
        status: 202,
        body: { assignment_id: id, work_revision: 1, run_id: runId },
      };
    },
  );
  saveState(state);
  return { status: result.status, body: result.body };
}

function createArtifact(
  state: MockState,
  a: Assignment,
  kind: ArtifactKind,
  title: string,
  body: Block[],
  partial: boolean,
  at: string,
): Artifact {
  const id = nextId(state, "art");
  const revId = nextId(state, "rev");
  const deps = Array.from(new Set(body.flatMap((b) => b.source_ids ?? []))).map(
    (sid) => {
      const ref = a.selected_source_refs.find((r) => r.id === sid);
      return { source_id: sid, version: ref?.version ?? "1" };
    },
  );
  const rev: Revision = {
    id: revId,
    artifact_id: id,
    parent_revision_id: null,
    sequence: 1,
    author: { kind: "agent", name: "Workagent" },
    created_at: at,
    status: "accepted",
    body,
    body_hash: bodyHash(body),
    source_dependencies: deps,
    note: "Generated from the selected sources.",
  };
  state.revisions[revId] = rev;
  const art: Artifact = {
    id,
    assignment_id: a.id,
    workspace_id: a.workspace_id,
    title,
    kind,
    state: "ready",
    partial,
    accepted_revision_id: revId,
    accepted_revision: rev,
    pending_proposal: null,
    observed_at: at,
    source_refs: a.selected_source_refs.filter((r) =>
      deps.some((d) => d.source_id === r.id),
    ),
  };
  state.artifacts[id] = art;
  for (const d of deps) {
    const src = state.sources[`${a.workspace_id}:${d.source_id}`];
    if (src && !src.used_by_artifact_ids.includes(id))
      src.used_by_artifact_ids.push(id);
  }
  return art;
}

function refOf(art: Artifact): ArtifactRef {
  return {
    id: art.id,
    title: art.title,
    kind: art.kind,
    state: art.state,
    accepted_revision_id: art.accepted_revision_id,
    partial: art.partial,
    updated_at: art.observed_at,
  };
}

/** Advance the mock run based on elapsed time. Idempotent; materializes each stage once. */
function progress(state: MockState, a: Assignment): boolean {
  if (!a.run) return false;
  const run = state.runs[a.run.run_id];
  if (!run || run.failed) return false;
  const elapsed = Date.now() - new Date(run.started_at).getTime();
  const target = Math.min(STAGES.length + 1, Math.floor(elapsed / STAGE_MS));
  let changed = false;
  while (run.materialized_stage < target) {
    const next = run.materialized_stage + 1;
    const at = nowIso();
    if (next <= STAGES.length) {
      const stage = STAGES[next - 1]!;
      a.state = "working";
      a.stage = stage;
      a.run.state = "running";
      a.run.last_update_at = at;
      a.next_step = "Results appear here as they are saved.";
      pushActivity(a, state, "stage", stage, at);
      if (next === 3) {
        const ids = a.selected_source_refs.map((r) => r.id);
        a.recommendation = buildRecommendation(ids);
        const analysis = createArtifact(
          state,
          a,
          "analysis",
          "Analysis",
          buildAnalysisBody(ids),
          true,
          at,
        );
        a.artifacts.push(refOf(analysis));
        a.latest_result = a.recommendation.summary;
        pushActivity(
          a,
          state,
          "artifact",
          "Analysis saved (partial result; plan and checklist still drafting).",
          at,
        );
      }
    } else {
      const ids = a.selected_source_refs.map((r) => r.id);
      const plan = createArtifact(
        state,
        a,
        "plan",
        "Working plan",
        buildPlanBody(ids),
        false,
        at,
      );
      const checklist = createArtifact(
        state,
        a,
        "checklist",
        "Intake review checklist",
        buildChecklistBody(ids),
        false,
        at,
      );
      a.artifacts.push(refOf(plan), refOf(checklist));
      const analysisRef = a.artifacts.find((r) => r.kind === "analysis");
      if (analysisRef) {
        analysisRef.partial = false;
        const art = state.artifacts[analysisRef.id];
        if (art) art.partial = false;
      }
      a.state = "ready_for_review";
      a.stage = null;
      a.run.state = "done";
      a.run.last_update_at = at;
      a.next_step = "Open the plan and adjust it to fit your week.";
      a.work_revision += 1;
      pushActivity(
        a,
        state,
        "artifact",
        "Working plan and checklist saved. Ready for your review.",
        at,
      );
    }
    run.materialized_stage = next;
    changed = true;
  }
  return changed;
}

function refreshArtifactRefs(state: MockState, a: Assignment): void {
  a.needs_review_artifact_ids = [];
  for (const ref of a.artifacts) {
    const art = state.artifacts[ref.id];
    if (!art) continue;
    ref.state = art.state;
    ref.accepted_revision_id = art.accepted_revision_id;
    ref.partial = art.partial;
    ref.updated_at = art.observed_at;
    if (art.state === "needs_review") a.needs_review_artifact_ids.push(art.id);
  }
}

function materialize(state: MockState, a: Assignment): void {
  let changed = progress(state, a);
  for (const ref of a.artifacts) {
    const art = state.artifacts[ref.id];
    if (art?.pending_proposal && art.pending_proposal.status === "generating") {
      changed = releaseIfDue(state, art, a) || changed;
    }
  }
  refreshArtifactRefs(state, a);
  a.observed_at = nowIso();
  if (changed) saveState(state);
}

export function listAssignments(
  principal: string,
  workspaceId: string,
): ListResult<AssignmentSummary> {
  const state = loadState();
  scope(state, principal, workspaceId);
  const items = Object.values(state.assignments)
    .filter((a) => a.workspace_id === workspaceId)
    .map((a) => {
      materialize(state, a);
      return summaryOf(a);
    })
    .sort((x, y) => (x.updated_at < y.updated_at ? 1 : -1));
  return { items, next_cursor: null, observed_at: nowIso() };
}

export function getAssignment(
  principal: string,
  workspaceId: string,
  id: string,
): Assignment {
  const state = loadState();
  scope(state, principal, workspaceId);
  const a = state.assignments[id];
  if (!a || a.workspace_id !== workspaceId) throw notFound();
  materialize(state, a);
  return a;
}

export function getAssignmentSources(
  principal: string,
  workspaceId: string,
  id: string,
): ListResult<SourceDetail> {
  const a = getAssignment(principal, workspaceId, id);
  const state = loadState();
  const items = a.selected_source_refs
    .map((r) => state.sources[`${workspaceId}:${r.id}`])
    .filter((s): s is SourceDetail => Boolean(s))
    .map((s) => ({
      ...s,
      used_by_artifact_ids: s.used_by_artifact_ids.filter((aid) =>
        a.artifacts.some((ar) => ar.id === aid),
      ),
    }));
  return { items, next_cursor: null, observed_at: nowIso() };
}

// ---------- artifacts ----------

function getArtifactScoped(
  state: MockState,
  principal: string,
  workspaceId: string,
  id: string,
): Artifact {
  scope(state, principal, workspaceId);
  const art = state.artifacts[id];
  if (!art || art.workspace_id !== workspaceId) throw notFound();
  const a = state.assignments[art.assignment_id];
  if (a) materialize(state, a);
  art.observed_at = nowIso();
  return art;
}

export function getArtifact(
  principal: string,
  workspaceId: string,
  id: string,
  revisionId?: string | null,
): Artifact {
  const state = loadState();
  const art = getArtifactScoped(state, principal, workspaceId, id);
  if (revisionId) {
    const rev = state.revisions[revisionId];
    if (!rev || rev.artifact_id !== id) throw notFound();
    // Historical read: the accepted pointer is unchanged; the body shown is the requested revision.
    return { ...art, accepted_revision: rev };
  }
  return art;
}

export function getArtifactHistory(
  principal: string,
  workspaceId: string,
  id: string,
): ArtifactHistory {
  const state = loadState();
  const art = getArtifactScoped(state, principal, workspaceId, id);
  const revisions = Object.values(state.revisions)
    .filter((r) => r.artifact_id === id)
    .sort((x, y) => y.sequence - x.sequence);
  const proposals = Object.values(state.proposals)
    .filter((p) => p.artifact_id === id)
    .sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
  return {
    artifact_id: id,
    accepted_revision_id: art.accepted_revision_id,
    revisions,
    proposals,
  };
}

function conflictError(state: MockState, art: Artifact): MockError {
  const current = art.accepted_revision_id
    ? state.revisions[art.accepted_revision_id]
    : undefined;
  return new MockError(
    "version_conflict",
    409,
    "The artifact changed since you loaded it.",
    "Review the current version; your draft is kept.",
    {
      current_revision_id: art.accepted_revision_id,
      current_revision: current ?? null,
      proposal: art.pending_proposal ?? null,
    },
  );
}

export function saveRevision(
  principal: string,
  workspaceId: string,
  id: string,
  cmd: SaveRevisionCommand,
): { status: number; body: SaveRevisionResult } {
  const state = loadState();
  const art = getArtifactScoped(state, principal, workspaceId, id);
  const { command_id, ...payload } = cmd;
  const result = withCommand(
    state,
    `${workspaceId}:${id}:save_revision`,
    command_id,
    payload,
    () => {
      if (!Array.isArray(payload.body) || payload.body.length === 0) {
        throw new MockError(
          "invalid_request",
          422,
          "A body is required.",
          "Keep at least one block.",
        );
      }
      if (art.accepted_revision_id !== payload.expected_current_revision_id)
        throw conflictError(state, art);
      const parent = art.accepted_revision_id
        ? state.revisions[art.accepted_revision_id]
        : undefined;
      if (parent) parent.status = "superseded";
      const at = nowIso();
      const rev: Revision = {
        id: nextId(state, "rev"),
        artifact_id: id,
        parent_revision_id: art.accepted_revision_id,
        sequence: (parent?.sequence ?? 0) + 1,
        author: { kind: "human", name: principalName(state, principal) },
        created_at: at,
        status: "accepted",
        body: payload.body,
        body_hash: bodyHash(payload.body),
        source_dependencies: parent?.source_dependencies ?? [],
        note: payload.note ?? null,
      };
      state.revisions[rev.id] = rev;
      art.accepted_revision_id = rev.id;
      art.accepted_revision = rev;
      art.observed_at = at;
      if (payload.resolves_proposal_id) {
        const p = state.proposals[payload.resolves_proposal_id];
        if (
          p &&
          p.artifact_id === id &&
          (p.status === "conflicted" || p.status === "proposed")
        ) {
          p.status = "accepted";
          p.resolved_by_revision_id = rev.id;
          p.updated_at = at;
          if (art.pending_proposal?.id === p.id) art.pending_proposal = null;
          art.state = "ready";
        }
      } else if (
        art.pending_proposal &&
        art.pending_proposal.status === "proposed"
      ) {
        // A new human save makes an un-reviewed proposal stale: keep it, mark it conflicted.
        art.pending_proposal.status = "conflicted";
        art.pending_proposal.conflict = {
          current_revision_id: rev.id,
          observed_at: at,
        };
        art.pending_proposal.updated_at = at;
        state.proposals[art.pending_proposal.id] = art.pending_proposal;
        art.state = "needs_review";
      }
      const a = state.assignments[art.assignment_id];
      if (a) {
        pushActivity(
          a,
          state,
          "human",
          `${art.title}: you saved revision ${rev.sequence}.`,
          at,
        );
        refreshArtifactRefs(state, a);
      }
      return { status: 200, body: { revision: rev, artifact: art } };
    },
  );
  saveState(state);
  return { status: result.status, body: result.body };
}

function principalName(state: MockState, principal: string): string {
  const ws = state.workspaces.find((w) => w.id === `ws_${principal}`);
  return ws ? ws.name.replace("’s workspace", "") : principal;
}

export function requestRevision(
  principal: string,
  workspaceId: string,
  id: string,
  cmd: RequestRevisionCommand,
): { status: number; body: RequestRevisionResult } {
  const state = loadState();
  const art = getArtifactScoped(state, principal, workspaceId, id);
  const { command_id, ...payload } = cmd;
  const result = withCommand(
    state,
    `${workspaceId}:${id}:request_revision`,
    command_id,
    payload,
    () => {
      const base = state.revisions[payload.base_revision_id];
      if (!base || base.artifact_id !== id) throw notFound();
      if (!payload.instruction.trim())
        throw new MockError(
          "invalid_request",
          422,
          "Say what should change.",
          "Describe the revision you want.",
        );
      if (
        art.pending_proposal &&
        (art.pending_proposal.status === "generating" ||
          art.pending_proposal.status === "proposed" ||
          art.pending_proposal.status === "conflicted")
      ) {
        throw new MockError(
          "decision_required",
          409,
          "A proposal for this artifact is already waiting for your review.",
          "Review or keep the current version first.",
        );
      }
      const at = nowIso();
      const p: Proposal = {
        id: nextId(state, "prop"),
        artifact_id: id,
        base_revision_id: base.id,
        base_sequence: base.sequence,
        status: "generating",
        author: { kind: "agent", name: "Workagent" },
        reason: payload.instruction.trim(),
        created_at: at,
        updated_at: at,
        body: null,
        body_hash: null,
        conflict: null,
        resolved_by_revision_id: null,
      };
      state.proposals[p.id] = p;
      state.proposal_instructions[p.id] = payload.instruction.trim();
      state.proposal_release_at[p.id] = new Date(
        Date.now() + PROPOSAL_MS,
      ).toISOString();
      art.pending_proposal = p;
      const a = state.assignments[art.assignment_id];
      if (a)
        pushActivity(
          a,
          state,
          "proposal",
          `${art.title}: revision requested from revision ${base.sequence}.`,
          at,
        );
      return {
        status: 202,
        body: { proposal_id: p.id, run_id: nextId(state, "run") },
      };
    },
  );
  saveState(state);
  return { status: result.status, body: result.body };
}

/** The agent finishes its proposal. Acceptance is attempted with the base as the expected current revision. */
function releaseProposal(
  state: MockState,
  art: Artifact,
  a: Assignment | undefined,
): void {
  const p = art.pending_proposal;
  if (!p || p.status !== "generating") return;
  const base = state.revisions[p.base_revision_id];
  const instruction = state.proposal_instructions[p.id] ?? p.reason;
  const at = nowIso();
  p.body = buildProposalBody(base?.body ?? [], instruction);
  p.body_hash = bodyHash(p.body);
  p.updated_at = at;
  state.proposal_release_at[p.id] = null;
  if (art.accepted_revision_id !== p.base_revision_id) {
    // CAS fails: the human saved a newer revision. Keep both bodies; the accepted pointer is unchanged.
    p.status = "conflicted";
    p.conflict = {
      current_revision_id: art.accepted_revision_id ?? "",
      observed_at: at,
    };
    art.state = "needs_review";
    if (a)
      pushActivity(
        a,
        state,
        "conflict",
        `${art.title}: a proposal based on revision ${p.base_sequence} needs review because you saved a newer version.`,
        at,
      );
  } else {
    p.status = "proposed";
    art.state = "needs_review";
    if (a)
      pushActivity(
        a,
        state,
        "proposal",
        `${art.title}: a proposed revision is ready for your review.`,
        at,
      );
  }
  state.proposals[p.id] = p;
  art.observed_at = at;
}

function releaseIfDue(
  state: MockState,
  art: Artifact,
  a: Assignment | undefined,
): boolean {
  const p = art.pending_proposal;
  if (!p || p.status !== "generating") return false;
  const due = state.proposal_release_at[p.id];
  if (!due || new Date(due).getTime() > Date.now()) return false;
  releaseProposal(state, art, a);
  return true;
}

export function acceptProposal(
  principal: string,
  workspaceId: string,
  id: string,
  proposalId: string,
  cmd: ProposalDecisionCommand,
): { status: number; body: ProposalDecisionResult } {
  const state = loadState();
  const art = getArtifactScoped(state, principal, workspaceId, id);
  const { command_id, ...payload } = cmd;
  const result = withCommand(
    state,
    `${workspaceId}:${id}:${proposalId}:accept`,
    command_id,
    payload,
    () => {
      const p = state.proposals[proposalId];
      if (!p || p.artifact_id !== id) throw notFound();
      if (p.status !== "proposed" || !p.body)
        throw new MockError(
          "decision_stale",
          409,
          "This proposal can no longer be applied as is.",
          "Review the current version.",
        );
      if (
        art.accepted_revision_id !== payload.expected_current_revision_id ||
        art.accepted_revision_id !== p.base_revision_id
      )
        throw conflictError(state, art);
      const parent = state.revisions[art.accepted_revision_id!];
      if (parent) parent.status = "superseded";
      const at = nowIso();
      const rev: Revision = {
        id: nextId(state, "rev"),
        artifact_id: id,
        parent_revision_id: art.accepted_revision_id,
        sequence: (parent?.sequence ?? 0) + 1,
        author: p.author,
        created_at: at,
        status: "accepted",
        body: p.body,
        body_hash: p.body_hash ?? bodyHash(p.body),
        source_dependencies: parent?.source_dependencies ?? [],
        note: `Applied proposal: ${p.reason}`,
      };
      state.revisions[rev.id] = rev;
      art.accepted_revision_id = rev.id;
      art.accepted_revision = rev;
      art.pending_proposal = null;
      art.state = "ready";
      art.observed_at = at;
      p.status = "accepted";
      p.resolved_by_revision_id = rev.id;
      p.updated_at = at;
      const a = state.assignments[art.assignment_id];
      if (a) {
        pushActivity(
          a,
          state,
          "human",
          `${art.title}: you applied the proposed revision as revision ${rev.sequence}.`,
          at,
        );
        refreshArtifactRefs(state, a);
      }
      return { status: 200, body: { proposal: p, artifact: art } };
    },
  );
  saveState(state);
  return { status: result.status, body: result.body };
}

export function declineProposal(
  principal: string,
  workspaceId: string,
  id: string,
  proposalId: string,
  cmd: ProposalDecisionCommand,
): { status: number; body: ProposalDecisionResult } {
  const state = loadState();
  const art = getArtifactScoped(state, principal, workspaceId, id);
  const { command_id, ...payload } = cmd;
  const result = withCommand(
    state,
    `${workspaceId}:${id}:${proposalId}:decline`,
    command_id,
    payload,
    () => {
      const p = state.proposals[proposalId];
      if (!p || p.artifact_id !== id) throw notFound();
      if (art.accepted_revision_id !== payload.expected_current_revision_id)
        throw conflictError(state, art);
      if (p.status !== "proposed" && p.status !== "conflicted")
        throw new MockError(
          "decision_stale",
          409,
          "This proposal was already resolved.",
          "Reload the artifact.",
        );
      const at = nowIso();
      p.status = "declined";
      p.updated_at = at;
      if (art.pending_proposal?.id === p.id) art.pending_proposal = null;
      art.state = "ready";
      art.observed_at = at;
      const a = state.assignments[art.assignment_id];
      if (a) {
        pushActivity(
          a,
          state,
          "human",
          `${art.title}: you kept your current version. The proposal stays in history.`,
          at,
        );
        refreshArtifactRefs(state, a);
      }
      return { status: 200, body: { proposal: p, artifact: art } };
    },
  );
  saveState(state);
  return { status: result.status, body: result.body };
}

// ---------- mock-only controls (test/demo; never part of the product contract) ----------

/**
 * Pause, resume or cancel, mirroring the backend's rules: compare-and-swap on
 * the work version, resume only from paused, cancelled is final. Pausing halts
 * the mock run; saved results are kept.
 */
export function controlAssignment(
  principal: string,
  workspaceId: string,
  id: string,
  cmd: ControlAssignmentCommand,
): { status: number; body: ControlAssignmentResult } {
  const state = loadState();
  scope(state, principal, workspaceId);
  const a = state.assignments[id];
  if (!a || a.workspace_id !== workspaceId) throw notFound();
  materialize(state, a);
  const { command_id, ...payload } = cmd;
  const result = withCommand(
    state,
    `${workspaceId}:${id}:control`,
    command_id,
    payload,
    () => {
      const lifecycle = a.lifecycle ?? "active";
      if (a.work_revision !== payload.expected_work_revision)
        throw new MockError(
          "version_conflict",
          409,
          "This work changed since you last looked.",
          "Review the current state, then try again.",
          { current_version: a.work_revision },
        );
      if (
        lifecycle === "cancelled" ||
        (payload.operation === "resume" && lifecycle !== "paused")
      )
        throw new MockError(
          "unsupported_operation",
          409,
          lifecycle === "cancelled"
            ? "This work was stopped and can’t be changed."
            : "Only paused work can be resumed.",
        );
      const run = a.run ? state.runs[a.run.run_id] : undefined;
      const at = nowIso();
      if (payload.operation === "resume") {
        a.lifecycle = "active";
        if (run) {
          run.failed = false;
          run.started_at = new Date(
            Date.now() - run.materialized_stage * STAGE_MS,
          ).toISOString();
        }
        pushActivity(a, state, "stage", "Resumed.", at);
      } else {
        if (run) run.failed = true;
        if (a.run && (a.run.state === "queued" || a.run.state === "running"))
          a.run.state = "waiting";
        a.lifecycle = payload.operation === "pause" ? "paused" : "cancelled";
        if (payload.operation === "cancel") a.state = "stopped";
        pushActivity(
          a,
          state,
          "stage",
          payload.operation === "pause"
            ? "Paused. Saved results are kept."
            : "Stopped. Saved results are kept.",
          at,
        );
      }
      a.work_revision += 1;
      return {
        status: 200,
        body: { work_revision: a.work_revision, lifecycle: a.lifecycle },
      };
    },
  );
  saveState(state);
  return { status: result.status, body: result.body };
}

export function controlReleaseProposal(proposalId: string): {
  released: boolean;
} {
  const state = loadState();
  const p = state.proposals[proposalId];
  if (!p) throw notFound();
  const art = state.artifacts[p.artifact_id];
  if (!art) throw notFound();
  const a = state.assignments[art.assignment_id];
  const before = p.status;
  releaseProposal(state, art, a);
  if (a) refreshArtifactRefs(state, a);
  saveState(state);
  return { released: before === "generating" };
}

export function controlAdvance(assignmentId: string): { state: string } {
  const state = loadState();
  const a = state.assignments[assignmentId];
  if (!a || !a.run) throw notFound();
  const run = state.runs[a.run.run_id];
  if (run)
    run.started_at = new Date(
      Date.now() - STAGE_MS * (STAGES.length + 2),
    ).toISOString();
  materialize(state, a);
  saveState(state);
  return { state: a.state };
}

export function controlReset(): { reset: true } {
  resetState();
  return { reset: true };
}

export function controlDump(): {
  assignments: number;
  artifacts: number;
  revisions: number;
  proposals: number;
} {
  const s = loadState();
  return {
    assignments: Object.keys(s.assignments).length,
    artifacts: Object.keys(s.artifacts).length,
    revisions: Object.keys(s.revisions).length,
    proposals: Object.keys(s.proposals).length,
  };
}
