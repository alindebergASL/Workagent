/** Plain-language views for queue entries, checkpoints and documents. Pure. */
import type {
  Coverage,
  DocumentMetadata,
  QueueHoldReason,
  QueuedMessage,
  RunCheckpoint,
} from "@/lib/contract/batch2";

const HOLD: Record<QueueHoldReason, string> = {
  work_changed:
    "Held: the conversation changed after you queued this. It won’t run against the newer state by itself.",
  scope_changed: "Held: the sources or access it relied on changed.",
  authority_unavailable: "Held: running it isn’t authorized right now.",
  outcome_unknown: "Held: an earlier request’s outcome is unknown.",
  paused: "Held: paused.",
};

export function queuedView(q: QueuedMessage): {
  label: string;
  note: string | null;
  cancellable: boolean;
} {
  switch (q.state) {
    case "pending":
      return {
        label: "Queued",
        note: "Runs after the current work settles.",
        cancellable: true,
      };
    case "held":
      return {
        label: "Held",
        note: HOLD[q.reason ?? "paused"],
        cancellable: true,
      };
    case "admitted":
      return { label: "Started", note: null, cancellable: false };
    case "cancelled":
      return { label: "Cancelled", note: null, cancellable: false };
  }
}

/**
 * The checkpoint Continue may use: the newest one by recorded time, and only
 * if it belongs to the latest run. An older checkpoint is never offered in
 * its place, even when it looked safe; no latest run known means none.
 */
export function continueTarget(
  items: RunCheckpoint[],
  latestRunId: string | null,
): RunCheckpoint | null {
  const latest = latestCheckpoint(items);
  return latest && latestRunId && latest.run_id === latestRunId ? latest : null;
}

/**
 * The latest run a fresh Continue may target, or null to withhold it. The
 * authority is the current canonical snapshot of exactly the conversation
 * version shown: not stale, same conversation, and a current checkpoint
 * read. Its execution names the latest run, which may be a successor run
 * with no newer request in the thread; with no run there, nothing is
 * offered (never a fallback to an earlier thread run). Replay of an existing
 * uncertain Continue doesn't depend on this.
 */
export function continueLatestRun(a: {
  snapshot: {
    conversation_id: string;
    work_version: number;
    execution: { run_id?: string | null };
  } | null;
  snapshotStale: boolean;
  checkpointsCurrent: boolean;
  conversationId: string;
  conversationVersion: number;
}): string | null {
  const s = a.snapshot;
  if (!s || a.snapshotStale || !a.checkpointsCurrent) return null;
  if (s.conversation_id !== a.conversationId) return null;
  if (s.work_version !== a.conversationVersion) return null;
  return s.execution.run_id ?? null;
}

/** Canonical run states that are still live even when no worker is seen. */
const STOPPABLE_EXECUTION = new Set([
  "queued",
  "running",
  "awaiting_provider",
  "recovering",
  "stale",
]);

/**
 * Whether Stop is offered for a turn. Queued/responding turns keep it. A turn
 * presented as unavailable (no worker observed) keeps it only while the
 * current canonical snapshot of exactly this conversation version still has
 * this exact run live; stopped, settled or other runs never qualify.
 */
export function stopOffered(a: {
  turnState: string;
  runId: string;
  snapshot: {
    conversation_id: string;
    work_version: number;
    execution: { run_id?: string | null; state: string };
  } | null;
  snapshotStale: boolean;
  conversationId: string;
  conversationVersion: number;
}): boolean {
  if (a.turnState === "queued" || a.turnState === "responding") return true;
  if (a.turnState !== "unavailable") return false;
  const s = a.snapshot;
  if (!s || a.snapshotStale) return false;
  if (s.conversation_id !== a.conversationId) return false;
  if (s.work_version !== a.conversationVersion) return false;
  return (
    s.execution.run_id === a.runId && STOPPABLE_EXECUTION.has(s.execution.state)
  );
}

/**
 * Checkpoint evidence a fresh Continue may rely on: the newest read
 * succeeded and is shown (not pending, not a cached copy kept through a
 * failed refresh, not an error).
 */
export const checkpointsCurrent = (r: {
  current: boolean;
  reconnecting: boolean;
  error: unknown;
}) => r.current && !r.reconnecting && !r.error;

/** The newest checkpoint, by its own recorded time (never by id). */
export function latestCheckpoint(items: RunCheckpoint[]): RunCheckpoint | null {
  let best: RunCheckpoint | null = null;
  for (const c of items)
    if (!best || Date.parse(c.created_at) > Date.parse(best.created_at))
      best = c;
  return best;
}

export type ContinueView =
  | { kind: "continue" }
  | { kind: "blocked"; text: string; parked?: true }
  | null;

/** Why the checkpoint's run stopped, as the server recorded it. */
export type RunStopReason =
  "budget_limit" | "blocked" | "waiting_for_user" | "step_limit" | null;

export function continueView(
  c: RunCheckpoint | null,
  stopReason: RunStopReason = null,
): ContinueView {
  if (!c) return null;
  const { waiting, next_safe_action: next } = c.data;
  // The server's bounded no-progress gate: a step-limited slice whose
  // settlement found nothing new is parked for a changed plan (not a
  // responsibility hold, not a tool refusal or budget stop).
  if (
    stopReason === "step_limit" &&
    c.checkpoint_kind === "settlement" &&
    c.assignment_id === null &&
    waiting === "blocked" &&
    next === "await_person"
  )
    return {
      kind: "blocked",
      parked: true,
      text: "Parked: it reached its step limit with no new progress, so it won’t continue on its own and Continue isn’t offered. Describe a different next step or new input, then Send.",
    };
  if (
    waiting === "none" &&
    (next === "continue_slice" || next === "resume_phase")
  )
    // Only when the server says this run can resume; absent fails closed.
    return c.continuation_supported === true
      ? { kind: "continue" }
      : {
          kind: "blocked",
          text: "This run can’t pick up from its last saved point. Send a new message to carry on.",
        };
  if (next === "settled") return null;
  const text =
    waiting === "unknown" || next === "reconcile"
      ? "An earlier request’s outcome is unknown. It won’t continue until that is reconciled; nothing is retried automatically."
      : waiting === "person" || next === "await_person"
        ? "Waiting for you. Reply to give it what it needs."
        : waiting === "event" || next === "await_event"
          ? "Waiting for a change it depends on."
          : waiting === "blocked"
            ? "Blocked. It can’t continue as things stand."
            : "Stopped. Send a new message to start again.";
  return { kind: "blocked", text };
}

const STATUS: Record<DocumentMetadata["status"], string> = {
  extracted: "Text read",
  truncated: "Text partly read",
  needs_ocr: "Scanned: no text read (needs OCR)",
  unsupported: "Text can’t be read from this file",
  encrypted: "Encrypted: no text read",
  failed: "Text couldn’t be read",
  unavailable: "Reading unavailable",
};

export const documentStatus = (d: Pick<DocumentMetadata, "status">) =>
  STATUS[d.status];

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One sentence on how much of the document the text covers. */
export function coverageLine(c: Coverage): string | null {
  if (c.total_pages !== undefined) {
    const ocr = c.empty_pages_needing_ocr?.length
      ? `; ${c.empty_pages_needing_ocr.length} page${c.empty_pages_needing_ocr.length === 1 ? "" : "s"} had no text`
      : "";
    return `Pages ${c.covered_pages ?? 0} of ${c.total_pages}${ocr}${c.partial_last_page ? "; last page cut short" : ""}.`;
  }
  if (c.total_paragraphs !== undefined)
    return `${c.paragraphs_covered ?? 0} of ${c.total_paragraphs} paragraphs and ${c.tables_covered ?? 0} of ${c.total_tables ?? 0} tables${c.partial_last_block ? "; last part cut short" : ""}.`;
  if (c.total_sheets !== undefined)
    return `${c.covered_sheets ?? 0} of ${c.total_sheets} sheets.`;
  return null;
}
