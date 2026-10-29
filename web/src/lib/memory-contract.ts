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

export function rememberProblem(f: RememberForm): string | null {
  if (!f.content.trim()) return "Write what should be remembered.";
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
  return {
    ...r,
    subject_key: null,
    predicate_key: null,
    content: null,
    content_sha256: null,
    confidence_basis: null,
    applicability: null,
    source_refs: [],
  };
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
    source_refs: [],
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
