/**
 * B2.3 current-state and event metadata (workagent/work-v1).
 *
 * TEMPORARY local adapter: mirrors backend/workagent/work_event_models.py
 * until the parent regenerates contracts/src. Shapes are validated at the
 * boundary and the result is a frozen copy; nothing reads the raw object
 * again after validation.
 */

export const WORK_SCHEMA = "workagent/work-v1" as const;

export const EVENT_TYPES = [
  "conversation.changed",
  "message.created",
  "run.changed",
  "artifact.changed",
  "revision.created",
  "proposal.changed",
  "responsibility.changed",
  "receipt.recorded",
  "audit.recorded",
] as const;
export type WorkEventType = (typeof EVENT_TYPES)[number];

export const REASON_CODES = [
  "material_change",
  "created",
  "state_changed",
  "receipt_retained",
  "cancelled_unapplied",
  "review_required",
] as const;
export type WorkReasonCode = (typeof REASON_CODES)[number];

export interface WorkEvent {
  readonly event_id: string;
  readonly type: WorkEventType;
  readonly conversation_id: string;
  readonly run_id: string | null;
  readonly artifact_id: string | null;
  readonly proposal_id: string | null;
  readonly assignment_id: string | null;
  readonly occurred_at: string;
  readonly reason_code: WorkReasonCode;
}

export interface EventPage {
  readonly events: readonly WorkEvent[];
  readonly next_cursor: string;
  readonly has_more: boolean;
  readonly reset_required: boolean;
  readonly checked_at: string;
}

export const EXECUTION_STATES = [
  "queued",
  "running",
  "awaiting_provider",
  "recovering",
  "stale",
  "stopped",
  "waiting_person",
  "blocked",
  "unknown",
  "idle",
] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

export interface CurrentExecution {
  readonly run_id: string | null;
  readonly state: ExecutionState;
  readonly reason: string | null;
  readonly phase: string | null;
  readonly admitted_at: string | null;
  readonly last_progress_at: string | null;
  readonly worker_observed_at: string | null;
  readonly worker_live: boolean;
  readonly admission: "not_admitted" | "admitted";
}

export const ARTIFACT_KINDS = [
  "table",
  "tool",
  "file",
  "document",
  "structured_table",
  "custom_view",
] as const;

export interface WorkArtifact {
  readonly id: string;
  readonly title: string;
  readonly kind: (typeof ARTIFACT_KINDS)[number];
  readonly current_revision_id: string;
  readonly body_hash: string;
}

export interface PendingReview {
  readonly proposal_id: string;
  readonly artifact_id: string;
  readonly base_revision_id: string;
  readonly base_work_version: number;
  readonly created_at: string;
  readonly fresh: boolean;
  readonly is_latest: boolean;
  readonly removed_content_count: number;
}

export const RESPONSIBILITY_STATES = [
  "active",
  "waiting_person",
  "waiting_event",
  "blocked",
  "paused",
  "cancelled",
  "taken_over",
] as const;
export type ResponsibilityState = (typeof RESPONSIBILITY_STATES)[number];

export const NEXT_ACTION_KINDS = [
  "continue_work",
  "review_dependency",
  "request_decision",
  "await_event",
  "obtain_grant",
  "obtain_tool",
] as const;

export interface WorkResponsibility {
  readonly assignment_id: string;
  readonly state: ResponsibilityState;
  readonly next_action: {
    readonly kind: (typeof NEXT_ACTION_KINDS)[number];
    readonly description: string;
  };
  readonly next_check_in_at: string | null;
  readonly historical_observation: {
    readonly text: string;
    readonly observed_at: string | null;
  } | null;
  readonly review_required: boolean;
}

export interface WorkSnapshot {
  readonly schema_version: typeof WORK_SCHEMA;
  readonly conversation_id: string;
  readonly work_version: number;
  readonly access_generation: number;
  readonly checked_at: string;
  readonly snapshot_cursor: string;
  readonly execution: CurrentExecution;
  readonly responsibility: readonly WorkResponsibility[];
  readonly artifacts: readonly WorkArtifact[];
  readonly pending_proposals: readonly PendingReview[];
}

export interface AttentionPage {
  readonly facts: readonly WorkEvent[];
  readonly next_cursor: string;
  readonly has_more: boolean;
  readonly reset_required: boolean;
  readonly checked_at: string;
}

// ---- boundary validation: copy only known fields, then freeze ----

export class ContractError extends Error {
  constructor(path: string) {
    super(`Unexpected work metadata at ${path}.`);
    this.name = "ContractError";
  }
}

type Obj = Record<string, unknown>;
const obj = (v: unknown, path: string): Obj => {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new ContractError(path);
  return v as Obj;
};
const str = (v: unknown, path: string, max = 128): string => {
  if (typeof v !== "string" || v.length < 1 || v.length > max)
    throw new ContractError(path);
  return v;
};
const optStr = (v: unknown, path: string, max = 128): string | null =>
  v === undefined || v === null ? null : str(v, path, max);
const bool = (v: unknown, path: string): boolean => {
  if (typeof v !== "boolean") throw new ContractError(path);
  return v;
};
const int = (v: unknown, path: string, min: number): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min)
    throw new ContractError(path);
  return v;
};
const time = (v: unknown, path: string): string => {
  const s = str(v, path, 64);
  if (Number.isNaN(Date.parse(s))) throw new ContractError(path);
  return s;
};
const optTime = (v: unknown, path: string): string | null =>
  v === undefined || v === null ? null : time(v, path);
const oneOf = <T extends string>(
  v: unknown,
  allowed: readonly T[],
  path: string,
): T => {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v))
    throw new ContractError(path);
  return v as T;
};
const list = <T>(
  v: unknown,
  path: string,
  each: (x: unknown, p: string) => T,
  max = 500,
): readonly T[] => {
  if (!Array.isArray(v) || v.length > max) throw new ContractError(path);
  return Object.freeze(v.map((x, i) => each(x, `${path}[${i}]`)));
};
const code = (v: unknown, path: string, re: RegExp): string | null => {
  const s = optStr(v, path, 64);
  if (s !== null && !re.test(s)) throw new ContractError(path);
  return s;
};

export function parseWorkEvent(raw: unknown, path = "event"): WorkEvent {
  const o = obj(raw, path);
  return Object.freeze({
    event_id: str(o.event_id, `${path}.event_id`),
    type: oneOf(o.type, EVENT_TYPES, `${path}.type`),
    conversation_id: str(o.conversation_id, `${path}.conversation_id`),
    run_id: optStr(o.run_id, `${path}.run_id`),
    artifact_id: optStr(o.artifact_id, `${path}.artifact_id`),
    proposal_id: optStr(o.proposal_id, `${path}.proposal_id`),
    assignment_id: optStr(o.assignment_id, `${path}.assignment_id`),
    occurred_at: time(o.occurred_at, `${path}.occurred_at`),
    reason_code: oneOf(o.reason_code, REASON_CODES, `${path}.reason_code`),
  });
}

function pageFields(o: Obj, path: string) {
  return {
    next_cursor: str(o.next_cursor, `${path}.next_cursor`),
    has_more: bool(o.has_more, `${path}.has_more`),
    reset_required:
      o.reset_required === undefined
        ? false
        : bool(o.reset_required, `${path}.reset_required`),
    checked_at: time(o.checked_at, `${path}.checked_at`),
  };
}

export function parseEventPage(raw: unknown): EventPage {
  const o = obj(raw, "page");
  return Object.freeze({
    events: list(o.events, "page.events", parseWorkEvent, 100),
    ...pageFields(o, "page"),
  });
}

export function parseAttentionPage(raw: unknown): AttentionPage {
  const o = obj(raw, "attention");
  return Object.freeze({
    facts: list(o.facts, "attention.facts", parseWorkEvent, 100),
    ...pageFields(o, "attention"),
  });
}

function parseExecution(raw: unknown): CurrentExecution {
  const p = "snapshot.execution";
  const o = obj(raw, p);
  return Object.freeze({
    run_id: optStr(o.run_id, `${p}.run_id`),
    state: oneOf(o.state, EXECUTION_STATES, `${p}.state`),
    reason: code(o.reason, `${p}.reason`, /^[a-z0-9_]+$/),
    phase: code(o.phase, `${p}.phase`, /^[a-z0-9_-]+$/),
    admitted_at: optTime(o.admitted_at, `${p}.admitted_at`),
    last_progress_at: optTime(o.last_progress_at, `${p}.last_progress_at`),
    worker_observed_at: optTime(
      o.worker_observed_at,
      `${p}.worker_observed_at`,
    ),
    worker_live: o.worker_live === undefined ? false : bool(o.worker_live, p),
    admission:
      o.admission === undefined
        ? "not_admitted"
        : oneOf(o.admission, ["not_admitted", "admitted"], `${p}.admission`),
  });
}

function parseResponsibility(raw: unknown, p: string): WorkResponsibility {
  const o = obj(raw, p);
  const next = obj(o.next_action, `${p}.next_action`);
  const hist =
    o.historical_observation === undefined || o.historical_observation === null
      ? null
      : obj(o.historical_observation, `${p}.historical_observation`);
  return Object.freeze({
    assignment_id: str(o.assignment_id, `${p}.assignment_id`),
    state: oneOf(o.state, RESPONSIBILITY_STATES, `${p}.state`),
    next_action: Object.freeze({
      kind: oneOf(next.kind, NEXT_ACTION_KINDS, `${p}.next_action.kind`),
      description: str(next.description, `${p}.next_action.description`, 10000),
    }),
    next_check_in_at: optTime(o.next_check_in_at, `${p}.next_check_in_at`),
    historical_observation: hist
      ? Object.freeze({
          text: str(hist.text, `${p}.historical_observation.text`, 10000),
          observed_at: optTime(
            hist.observed_at,
            `${p}.historical_observation.observed_at`,
          ),
        })
      : null,
    review_required: bool(o.review_required, `${p}.review_required`),
  });
}

function parseArtifact(raw: unknown, p: string): WorkArtifact {
  const o = obj(raw, p);
  return Object.freeze({
    id: str(o.id, `${p}.id`),
    title: typeof o.title === "string" && o.title.length <= 240 ? o.title : "",
    kind: oneOf(o.kind, ARTIFACT_KINDS, `${p}.kind`),
    current_revision_id: str(o.current_revision_id, `${p}.current_revision_id`),
    body_hash: str(o.body_hash, `${p}.body_hash`),
  });
}

function parseReview(raw: unknown, p: string): PendingReview {
  const o = obj(raw, p);
  return Object.freeze({
    proposal_id: str(o.proposal_id, `${p}.proposal_id`),
    artifact_id: str(o.artifact_id, `${p}.artifact_id`),
    base_revision_id: str(o.base_revision_id, `${p}.base_revision_id`),
    base_work_version: int(o.base_work_version, `${p}.base_work_version`, 1),
    created_at: time(o.created_at, `${p}.created_at`),
    fresh: bool(o.fresh, `${p}.fresh`),
    is_latest: bool(o.is_latest, `${p}.is_latest`),
    removed_content_count: int(
      o.removed_content_count,
      `${p}.removed_content_count`,
      0,
    ),
  });
}

export function parseWorkSnapshot(raw: unknown): WorkSnapshot {
  const o = obj(raw, "snapshot");
  if (o.schema_version !== WORK_SCHEMA)
    throw new ContractError("snapshot.schema_version");
  return Object.freeze({
    schema_version: WORK_SCHEMA,
    conversation_id: str(o.conversation_id, "snapshot.conversation_id"),
    work_version: int(o.work_version, "snapshot.work_version", 1),
    access_generation: int(
      o.access_generation,
      "snapshot.access_generation",
      1,
    ),
    checked_at: time(o.checked_at, "snapshot.checked_at"),
    snapshot_cursor: str(o.snapshot_cursor, "snapshot.snapshot_cursor"),
    execution: parseExecution(o.execution),
    responsibility: list(
      o.responsibility,
      "snapshot.responsibility",
      parseResponsibility,
    ),
    artifacts: list(o.artifacts, "snapshot.artifacts", parseArtifact),
    pending_proposals: list(
      o.pending_proposals,
      "snapshot.pending_proposals",
      parseReview,
    ),
  });
}
