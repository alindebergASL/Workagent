/**
 * B3.1b memory view helpers. Every wire shape is an alias of the generated
 * workagent/v1 contract (contracts/src/schema.d.ts, from the canonical
 * backend/workagent/memory/models.py); nothing here is a second wire
 * contract. Only labels, form-to-body assembly and erasure-safe merging live
 * here. Nothing in this module touches storage.
 */
import type { components } from "../../../contracts/src/client";

type S = components["schemas"];

export type MemoryRevision = S["MemoryRevisionV1"];
export type MemoryReceipt = S["MemoryReceipt"];
export type MemoryInspection = S["MemoryInspection"];
export type MemoryPage = S["MemoryPage"];
export type RecalledMemory = S["RecalledMemory"];
export type RememberMemory = S["RememberMemory"];
export type ProposeMemory = S["ProposeMemory"];
export type ReviewMemory = S["ReviewMemory"];
export type CorrectMemory = S["CorrectMemory"];
export type NarrowMemory = S["NarrowMemory"];
export type MemoryCAS = S["MemoryCAS"];
export type MemoryUsagePage = S["MemoryUsagePage"];
export type BindMemoryScope = S["BindMemoryScope"];
export type MemoryScopeBinding = S["MemoryScopeBinding"];

export type MemoryKind = MemoryRevision["kind"];
export type MemoryScopeKind = MemoryRevision["scope_kind"];
export type MemoryStatus = MemoryRevision["status"];
export type RecallWhy = RecalledMemory["why"];
export type ReviewDecision = ReviewMemory["decision"];

export const KIND_LABEL: Record<MemoryKind, string> = {
  fact: "Fact",
  preference: "Preference",
  project_convention: "Project convention",
  episode: "Something that happened",
  procedure: "Procedure",
};

export const SCOPE_LABEL: Record<MemoryScopeKind, string> = {
  task: "This conversation only",
  work_area: "This project",
  user: "All my work in this workspace",
};

export const STATUS_LABEL: Record<MemoryStatus, string> = {
  candidate: "Waiting for your review",
  active: "In use",
  contested: "Disputed",
  superseded: "Replaced by a correction",
  expired: "Expired",
  forgotten: "Forgotten",
};

export const ORIGIN_LABEL: Record<MemoryRevision["origin"], string> = {
  human_explicit: "You asked to remember this",
  human_reviewed: "You reviewed and accepted this",
  agent_inferred: "Suggested by the assistant",
  external_source: "From a source",
  tool_observed: "Observed by a tool",
};

export const WHY_LABEL: Record<RecallWhy, string> = {
  task: "Saved for this conversation",
  explicit_work_area_binding: "This conversation is linked to the project",
  owner_preference: "One of your general preferences",
};

/** Mirrors the server bound; the server still decides. */
export const MAX_CONTENT = 4000;
const KEY_RE = /^[a-z0-9][a-z0-9_.:-]*$/;

/** A plain sentence becomes a stable, valid structured key. */
export function toKey(text: string, fallback: string): string {
  const k = text
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/_+$/, "")
    .slice(0, 160);
  return KEY_RE.test(k) ? k : fallback;
}

export interface RememberForm {
  kind: MemoryKind;
  scope_kind: MemoryScopeKind;
  subject: string;
  content: string;
  applicability: string;
}

/** Task scope is the default; anything broader is a deliberate choice. */
export const emptyRememberForm = (): RememberForm => ({
  kind: "fact",
  scope_kind: "task",
  subject: "",
  content: "",
  applicability: "",
});

/**
 * Procedures are lessons from specific work: they stay in this conversation
 * or an explicitly chosen project, never all work in the workspace.
 */
export const PROCEDURE_SCOPES: readonly MemoryScopeKind[] = [
  "task",
  "work_area",
];

export function rememberProblem(f: RememberForm): string | null {
  if (!f.content.trim()) return "Write what should be remembered.";
  if (f.kind === "procedure" && !PROCEDURE_SCOPES.includes(f.scope_kind))
    return "Procedures apply to this conversation or a chosen project only.";
  if (f.content.length > MAX_CONTENT)
    return `Keep it under ${MAX_CONTENT} characters.`;
  return null;
}

/** The scope ID each scope kind uses for this conversation's context. */
export function scopeIdFor(
  kind: MemoryScopeKind,
  ctx: { conversationId: string; workAreaId: string | null; ownerId: string },
): string | null {
  if (kind === "task") return ctx.conversationId;
  if (kind === "work_area") return ctx.workAreaId;
  return ctx.ownerId;
}

type Envelope = Pick<
  RememberMemory,
  "schema_version" | "request_id" | "command_id"
>;

/**
 * Explicit remember, or a candidate when the kind is a procedure (procedures
 * are always reviewed before use). Returns which route the body belongs to.
 */
export function rememberBody(
  f: RememberForm,
  scopeId: string,
  env: Envelope,
): { route: "remember" | "candidates"; body: RememberMemory } {
  const subject = toKey(f.subject || f.content.slice(0, 60), "note");
  const body: RememberMemory = {
    ...env,
    kind: f.kind,
    scope_kind: f.scope_kind,
    scope_id: scopeId,
    subject_key: subject,
    predicate_key: f.kind,
    content: f.content,
    source_refs: [],
    confidence_basis: "Explicit human statement",
    applicability: f.applicability,
    sensitivity: "ordinary",
  };
  return { route: f.kind === "procedure" ? "candidates" : "remember", body };
}

export const isErased = (r: MemoryRevision): boolean =>
  r.status === "forgotten" || r.content === null;

/**
 * A revision safe to render: an erased one carries none of its former
 * payload, even if a stale copy of the payload still sits in client state.
 */
export function renderable(r: MemoryRevision): MemoryRevision {
  if (!isErased(r)) return r;
  const erased: MemoryRevision = {
    ...r,
    procedure: null,
    subject_key: null,
    predicate_key: null,
    content: null,
    content_sha256: null,
    confidence_basis: null,
    applicability: null,
    source_refs: [],
  };
  return erased;
}

/**
 * Replaces one memory's entry with an exact readback. The old entry (and any
 * payload in it) is dropped, never merged.
 */
export function withInspection(
  items: readonly RecalledMemory[],
  inspection: MemoryInspection,
): RecalledMemory[] {
  const id = inspection.current.memory_id;
  return items.map((it) =>
    it.revision.memory_id === id
      ? { ...it, revision: renderable(inspection.current) }
      : it,
  );
}

/**
 * A definite forget receipt erases the entry here at once, before (and
 * regardless of) any readback: no former payload stays in client state.
 */
export function purgeForgotten(
  items: readonly RecalledMemory[],
  receipt: MemoryReceipt,
): RecalledMemory[] {
  return items.map((it) =>
    it.revision.memory_id === receipt.memory_id
      ? {
          ...it,
          revision: renderable({
            ...it.revision,
            revision_id: receipt.revision_id,
            status: "forgotten",
            content: null,
          }),
        }
      : it,
  );
}

/**
 * Memories this page has a forget receipt for never come back with payload,
 * even if an older (or lagging) read still carries it.
 */
export function maskForgotten(
  items: readonly RecalledMemory[],
  forgotten: ReadonlySet<string>,
): RecalledMemory[] {
  if (forgotten.size === 0) return [...items];
  return items.map((it) =>
    forgotten.has(it.revision.memory_id)
      ? {
          ...it,
          revision: renderable({
            ...it.revision,
            status: "forgotten",
            content: null,
          }),
        }
      : it,
  );
}

/**
 * Clears a form after its write only if it is still the exact version that
 * was submitted; newer, unsent typing is kept.
 */
export const clearIfSubmitted = <T>(current: T, submitted: T, empty: T): T =>
  current === submitted ? empty : current;

/** A correction draft, pinned to the revision it was written against. */
export interface CorrectionDraft {
  base: string;
  content: string;
  mode: "permanent" | "temporary";
  from: string;
  until: string;
  /**
   * Procedures only: edited details. Applicability/basis are shown read-only
   * and never sent; evidence stays the base's (not editable).
   */
  procedure?: ProcedureForm;
  /** Procedures only: the base's exact evidence and source dependencies. */
  keep?: { evidence: ProcedureEvidence[]; source_refs: MemorySourceRef[] };
}

/**
 * The memory changed after this draft was started. Saving is refused until
 * the person explicitly re-pins the draft to the current revision.
 */
export const correctionRebased = (
  d: CorrectionDraft,
  currentRevisionId: string,
): boolean => d.base !== currentRevisionId;

/** Compare-and-swap is against the draft's pinned base, never a newer one. */
export function correctionBody(
  d: CorrectionDraft,
  env: Pick<CorrectMemory, "schema_version" | "request_id" | "command_id">,
): CorrectMemory {
  return {
    ...env,
    expected_revision_id: d.base,
    content: d.content,
    mode: d.mode,
    source_refs: d.keep ? d.keep.source_refs : [],
    // Applicability and basis are fixed at correction; only details change.
    ...(d.procedure && d.keep
      ? { procedure: procedureDetails(d.procedure, d.keep.evidence) }
      : {}),
    ...(d.mode === "temporary"
      ? {
          valid_from: new Date(d.from).toISOString(),
          valid_until: new Date(d.until).toISOString(),
        }
      : {}),
  };
}

/** The receipt is verified only when the readback shows that exact revision. */
export const readbackMatches = (
  receipt: MemoryReceipt,
  inspection: MemoryInspection,
): boolean =>
  inspection.current.memory_id === receipt.memory_id &&
  inspection.current.revision_id === receipt.revision_id &&
  inspection.current.status === receipt.status;

export function validityText(r: MemoryRevision): string {
  const d = (s: string) => new Date(s).toLocaleDateString();
  const until = r.valid_until ?? r.expires_at;
  return until
    ? `${d(r.valid_from)} – ${d(until)}`
    : `Since ${d(r.valid_from)}`;
}

/**
 * The project scope this conversation can use. A conversation that is itself
 * a work area uses its own id; any other conversation only after an explicit,
 * read-back human binding. Same-user membership is never inferred.
 */
export function projectScopeId(
  conversation: { id: string; isWorkArea: boolean },
  binding: MemoryScopeBinding | null | undefined,
): string | null {
  if (conversation.isWorkArea) return conversation.id;
  return binding && binding.conversation_id === conversation.id
    ? binding.work_area_id
    : null;
}

/** A link is confirmed only by a readback naming this exact pair. */
export const bindingMatches = (
  sent: Pick<BindMemoryScope, "conversation_id" | "work_area_id">,
  read: MemoryScopeBinding | null,
): boolean =>
  !!read &&
  read.conversation_id === sent.conversation_id &&
  read.work_area_id === sent.work_area_id;

export type MemorySourceRef = NonNullable<
  MemoryRevision["source_refs"]
>[number];

/**
 * Inert provenance line for one source: kind plus its identifying fields
 * (IDs, version, hash). Never the source's content.
 */
export function sourceRefText(s: MemorySourceRef): string {
  if (s.source_type === "memory") {
    return `Memory (memory_id: ${s.ref.memory_id}, revision_id: ${s.ref.revision_id}, sha256: ${s.ref.sha256})`;
  }
  return s.source_type === "file"
    ? `Saved file (workspace_file_id: ${s.ref.workspace_file_id}, version_id: ${s.ref.version_id}, sha256: ${s.ref.sha256})`
    : `Source (source_id: ${s.ref.source_id}, external_version: ${s.ref.external_version}, observed_at: ${s.ref.observed_at})`;
}

/** Access to this memory view is gone: drop every server payload shown. */
export const isAccessLoss = (e: unknown): boolean => {
  const x = e as { status?: unknown; code?: unknown } | null;
  return (
    !!x &&
    (x.status === 401 ||
      x.status === 403 ||
      x.code === "unauthenticated" ||
      x.code === "not_found_or_not_authorized")
  );
};

/* B3.4a evidence-backed procedures and rollback (generated aliases). */
export type ProcedureEvidence = S["ProcedureEvidence"];
export type ProcedureDetails = S["ProcedureDetails"];
export type ProcedureEvidenceOption = S["ProcedureEvidenceOption"];
export type OperationalOutcome = NonNullable<
  ProcedureEvidenceOption["operational_outcome"]
>;
export type ProcedureEvidencePage = S["ProcedureEvidencePage"];
export type EvidenceOutcome = ProcedureEvidenceOption["outcome"];
export type RollbackMemory = S["RollbackMemory"];
export type ProposeProcedureMemory = ProposeMemory & {
  procedure: ProcedureDetails;
};

export const procedureOf = (r: MemoryRevision): ProcedureDetails | null =>
  isErased(r) ? null : (r.procedure ?? null);

export const EVIDENCE_KIND_LABEL: Record<ProcedureEvidence["kind"], string> = {
  human_message: "Your message",
  tool_observation: "Observed tool result",
};

/**
 * Exact server outcome labels. "observed" is only a receipt that something
 * happened, never a success; nothing here falls back to success.
 */
export const OUTCOME_LABEL: Record<EvidenceOutcome, string> = {
  human_statement: "What you said",
  observed: "Observed (a record it happened, not proof it worked)",
  failed: "Failed",
  cost_only: "Only a cost was recorded",
  outcome_unknown: "Outcome unknown",
};

/** What the operation itself reported, exactly as the server derived it. */
export const OPERATIONAL_LABEL: Record<OperationalOutcome, string> = {
  succeeded: "Operation reported success",
  failed: "Operation failed",
  wall_limit: "Stopped at the time limit",
  cpu_limit: "Stopped at the compute limit",
  output_limit: "Stopped at the output limit",
  cancelled: "Cancelled",
  unavailable: "Unavailable",
  available: "Available",
  rate_limited: "Rate limited",
  not_found: "Not found",
  denied: "Denied",
  changed_source: "Source changed",
  captured: "Captured",
  uncertain: "Uncertain",
  outcome_unknown: "Operation outcome unknown",
};

const NOT_SUCCESS_OUTER: ReadonlySet<EvidenceOutcome> = new Set([
  "failed",
  "cost_only",
  "outcome_unknown",
]);
const OPERATIONAL_OK: ReadonlySet<OperationalOutcome> = new Set([
  "succeeded",
  "available",
  "captured",
]);

/** The outer receipt or the operation itself says this didn't succeed. */
export const isFailureOutcome = (
  o: EvidenceOutcome,
  operational?: OperationalOutcome | null,
): boolean =>
  NOT_SUCCESS_OUTER.has(o) ||
  (!!operational && !OPERATIONAL_OK.has(operational));

/**
 * Times shown to a person carry their zone, so the same moment reads
 * unambiguously anywhere. (dateStyle/timeStyle can't be combined with
 * timeZoneName: Intl throws, so the parts are spelled out.)
 */
export const WHEN_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

/**
 * Inert, honest line: label, outer outcome, and the operation's own outcome
 * when known. An outer "observed" never reads as success on its own.
 */
export function evidenceOptionText(o: ProcedureEvidenceOption): string {
  const when = new Date(o.observed_at).toLocaleString(undefined, WHEN_FORMAT);
  const op = o.operational_outcome
    ? ` · Operation: ${OPERATIONAL_LABEL[o.operational_outcome]}`
    : "";
  return `${EVIDENCE_KIND_LABEL[o.evidence.kind]}: ${o.label} · ${OUTCOME_LABEL[o.outcome]}${op} · ${when}`;
}

/** Inert provenance line: exact event and digest, never the event content. */
export const evidenceRefText = (e: ProcedureEvidence): string =>
  `${EVIDENCE_KIND_LABEL[e.kind]} (conversation_id: ${e.conversation_id}, event_id: ${e.event_id}, sha256: ${e.sha256})`;

export const sameEvidence = (a: ProcedureEvidence, b: ProcedureEvidence) =>
  a.kind === b.kind &&
  a.conversation_id === b.conversation_id &&
  a.event_id === b.event_id &&
  a.sha256 === b.sha256;

/** Plain fields a person fills; lists are one entry per line. */
export interface ProcedureForm {
  applicability: string;
  confidence_basis: string;
  counterexamples: string;
  validation_notes: string;
  retrieval_terms: string;
  excluded_terms: string;
}

export const emptyProcedureForm = (): ProcedureForm => ({
  applicability: "",
  confidence_basis: "",
  counterexamples: "",
  validation_notes: "",
  retrieval_terms: "",
  excluded_terms: "",
});

const lines = (s: string): string[] =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

export const procedureFormOf = (
  r: MemoryRevision,
  p: ProcedureDetails | null,
): ProcedureForm => ({
  applicability: r.applicability ?? "",
  confidence_basis: r.confidence_basis ?? "",
  counterexamples: (p?.counterexamples ?? []).join("\n"),
  validation_notes: p?.validation_notes ?? "",
  retrieval_terms: (p?.retrieval_terms ?? []).join("\n"),
  excluded_terms: (p?.excluded_terms ?? []).join("\n"),
});

export function procedureDetails(
  f: ProcedureForm,
  evidence: ProcedureEvidence[],
): ProcedureDetails {
  return {
    retrieval_terms: lines(f.retrieval_terms),
    excluded_terms: lines(f.excluded_terms),
    counterexamples: lines(f.counterexamples),
    evidence: [...evidence],
    validation_notes: f.validation_notes.trim(),
  };
}

/** Mirrors the server's required fields; the server still decides. */
export function procedureProblem(
  f: ProcedureForm,
  evidence: readonly ProcedureEvidence[],
): string | null {
  if (!f.applicability.trim()) return "Say when this applies.";
  if (!f.confidence_basis.trim()) return "Say what this is based on.";
  if (!lines(f.counterexamples).length)
    return "Add at least one limit or case where it doesn’t apply.";
  if (!evidence.length) return "Choose at least one observation it comes from.";
  if (!lines(f.retrieval_terms).length)
    return "Add at least one matching word (under Matching words).";
  return null;
}

/**
 * An explicit human proposal of an inferred lesson. Always a candidate: it
 * stays out of future work until reviewed. Evidence is exact references the
 * server derived; no evidence content is copied here.
 */
export function procedureCandidateBody(
  f: RememberForm,
  p: ProcedureForm,
  evidence: ProcedureEvidence[],
  sourceRefs: MemorySourceRef[],
  scopeId: string,
  env: Envelope,
): ProposeProcedureMemory {
  return {
    ...env,
    kind: "procedure",
    scope_kind: f.scope_kind,
    scope_id: scopeId,
    subject_key: toKey(f.subject || f.content.slice(0, 60), "procedure"),
    predicate_key: "procedure",
    content: f.content,
    source_refs: [...sourceRefs],
    confidence_basis: p.confidence_basis.trim(),
    applicability: p.applicability.trim(),
    sensitivity: "ordinary",
    procedure: procedureDetails(p, evidence),
  };
}

/** A procedure without evidence-backed details can't be adopted or recalled. */
export const needsProcedureDetails = (r: MemoryRevision): boolean =>
  r.kind === "procedure" && !isErased(r) && procedureOf(r) === null;

/**
 * Earlier versions a person may restore: exactly the revisions the server
 * lists in `rollback_revision_ids` (it derives original adoption and checks
 * rollback authorization against the current one). Status is not consulted:
 * history legitimately shows an adopted version as superseded. Absent or
 * empty means nothing can be restored. The server still decides on send.
 */
export function rollbackTargets(ins: MemoryInspection): MemoryRevision[] {
  const ids = new Set(ins.rollback_revision_ids ?? []);
  return ins.revisions.filter(
    (r) =>
      ids.has(r.revision_id) &&
      r.memory_id === ins.current.memory_id &&
      r.revision_id !== ins.current.revision_id &&
      !isErased(r),
  );
}

/**
 * Confidence describes where the content came from, not whether it was
 * approved. A reviewed inference stays "inferred": accepting adopts it for
 * use, it doesn't test that it works.
 */
export const CONFIDENCE_LABEL: Record<
  MemoryRevision["confidence_label"],
  string
> = {
  explicit: "Stated directly by you",
  observed: "Observed",
  inferred: "Inferred, not directly stated",
  uncertain: "Uncertain",
};

export const reviewedInference = (r: MemoryRevision): boolean =>
  r.origin === "human_reviewed" && r.confidence_label === "inferred";

export const rollbackBody = (
  env: Envelope,
  currentRevisionId: string,
  targetRevisionId: string,
): RollbackMemory => ({
  ...env,
  expected_revision_id: currentRevisionId,
  target_revision_id: targetRevisionId,
});
