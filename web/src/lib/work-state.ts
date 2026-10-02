import type {
  Assignment,
  AssignmentSummary,
  ExecutionProvenance,
  RunOutcome,
} from "./contract/types";

/**
 * Where a piece of work stands. When the backend projects a responsibility
 * outcome, the run named by `latest_run_id` is authoritative (never the first
 * or last historical run). Otherwise the read summary decides: assignment
 * state plus actual artifact and proposal receipts. Never client flags, so
 * finished work cannot keep in-progress or delegation controls, and prepared
 * work never silently loses the review it needs.
 *
 * - decision: a proposal waits on the person (exact or stale base).
 * - prepared: the document is saved; the next action itself was NOT performed.
 * - approved: an accepted revision; a document change only, never an external
 *   effect or fulfilment of the underlying task.
 * - unknown: a provider dispatch may have happened; nothing to retry.
 * - waiting: an availability or control blocker the backend names.
 * - unverified: document evidence is missing; never presented as done.
 */
export type WorkPhase =
  | "decision"
  | "blocked"
  | "working"
  | "prepared"
  | "approved"
  | "stopped"
  | "unknown"
  | "waiting"
  | "unverified";

/** The current run outcome, if the backend projects one. */
export function currentRun(a: AssignmentSummary): RunOutcome | null {
  const r = a.responsibility;
  if (!r?.latest_run_id) return null;
  return r.runs?.find((x) => x.run_id === r.latest_run_id) ?? null;
}

export function phaseOf(a: AssignmentSummary): WorkPhase {
  if (a.state === "stopped") return "stopped";
  const run = currentRun(a);
  if (run)
    switch (run.state) {
      case "decision_required":
      case "decision_stale":
        return "decision";
      case "preparing":
        return "working";
      case "prepared":
        return "prepared";
      case "approved":
      case "readback_verified":
        return "approved";
      case "outcome_unknown":
        return "unknown";
      case "waiting":
        return "waiting";
      case "unverified":
        return "unverified";
    }
  if (a.needs_review_artifact_ids.length) return "decision";
  switch (a.state) {
    case "needs_input":
    case "failed":
      return "blocked";
    case "queued":
    case "working":
      return "working";
    case "finished":
      return "approved";
    case "ready_for_review":
      return "prepared";
  }
}

/** The artifact a pending decision concerns: the exact question binding first. */
export function decisionArtifactId(a: AssignmentSummary): string | null {
  return (
    currentRun(a)?.question?.artifact_id ??
    a.needs_review_artifact_ids[0] ??
    null
  );
}

const BLOCKER_LABEL: Record<NonNullable<RunOutcome["blocker"]>, string> = {
  paused: "Paused",
  cancelled: "Stopped",
  grant_revoked: "Access withdrawn",
  grant_expired: "Access expired",
  source_changed: "A source changed",
  runtime_unavailable: "Agent unavailable",
  consumer_unavailable: "Agent not connected",
  lease_expired: "Waiting to resume",
  prepared_attempt: "Not sent",
  provider_outcome_unknown: "Waiting to confirm",
  publication_pending: "Saving result",
  unsent_abandoned: "Not sent",
  unresolved_items: "Needs your input",
  decision_required: "Decision needed",
  decision_stale: "Decision needed",
};

const WAITING_SUMMARY: Partial<
  Record<NonNullable<RunOutcome["blocker"]>, string>
> = {
  consumer_unavailable:
    "The agent that would prepare this isn’t connected yet. Nothing has been sent.",
  runtime_unavailable:
    "The agent that would prepare this isn’t available. Nothing has been sent.",
  paused: "Paused. Saved results are kept.",
  cancelled: "Stopped. Saved results are kept.",
  grant_revoked:
    "Access for this work was withdrawn. Nothing new will be sent.",
  grant_expired: "Access for this work expired. Nothing new will be sent.",
  source_changed:
    "A source changed since this started. Check your sources before continuing.",
  lease_expired: "Interrupted. Waiting to resume safely.",
  prepared_attempt: "A request was prepared but not sent.",
  unsent_abandoned: "A prepared request was closed without being sent.",
  publication_pending: "A result arrived and is waiting to be saved.",
};

/** Plain words for a waiting run; the server's own reason stays available on demand. */
export function waitingSummary(run: RunOutcome | null): string {
  return (
    (run?.blocker && WAITING_SUMMARY[run.blocker]) ??
    "Waiting before this can continue. Saved results are kept."
  );
}

/** The status label shown on Home, Spaces and the work surface, same everywhere. */
export function statusOf(a: AssignmentSummary): {
  label: string;
  tone: string;
} {
  const phase = phaseOf(a);
  const run = currentRun(a);
  switch (phase) {
    case "decision":
      return { label: "Decision needed", tone: "status-attention" };
    case "prepared":
      return { label: "Ready for review", tone: "status-ready" };
    case "approved":
      return run?.state === "approved"
        ? { label: "Approved, since edited", tone: "status-ok" }
        : { label: "Approved revision", tone: "status-ok" };
    case "unknown":
      return { label: "Waiting to confirm", tone: "status-working" };
    case "waiting":
      return {
        label: (run?.blocker && BLOCKER_LABEL[run.blocker]) ?? "Waiting",
        tone: "status-working",
      };
    case "unverified":
      return { label: "Not verified", tone: "status-attention" };
    case "working":
      // The assignment's own queued/working state is the more specific label.
      break;
    case "stopped":
      return { label: "Stopped", tone: "" };
  }
  return legacyStatus(a);
}

function legacyStatus(a: AssignmentSummary): { label: string; tone: string } {
  switch (a.state) {
    case "queued":
      return { label: "Queued", tone: "status-working" };
    case "working":
      return {
        label: a.stage ? `Working · ${a.stage}` : "Working",
        tone: "status-working",
      };
    case "ready_for_review":
      return { label: "Ready for review", tone: "status-ready" };
    case "needs_input":
      return { label: "Needs your input", tone: "status-attention" };
    case "finished":
      return { label: "Approved revision", tone: "status-ok" };
    case "stopped":
      return { label: "Stopped", tone: "" };
    case "failed":
      return { label: "Didn’t finish", tone: "status-error" };
  }
}

/**
 * Where an item's execution came from, from the server-attested
 * `evidence_origin` only. A model name, managed mode or a received provider
 * observation is never live evidence. Items without provenance keep the
 * build-wide fixture label (null here).
 */
export function provenanceOf(
  e: ExecutionProvenance | null | undefined,
): { label: string; live: boolean } | null {
  if (!e) return null;
  switch (e.evidence_origin) {
    case "fixture":
      return {
        label: "Prepared by the fixture worker · not a live run",
        live: false,
      };
    case "synthetic_provider_receipt":
      return { label: "Synthetic test receipt · not a live run", live: false };
    case "live_provider_receipt":
      return { label: "Live provider run (server-attested)", live: true };
    default:
      return { label: "Run origin not verified", live: false };
  }
}

const CHECK_LABEL: Record<string, string> = {
  publication_binding: "Saved to the right record",
  saved_body: "Saved text matches what was prepared",
  exact_base: "Based on the exact revision you saw",
  current_revision: "Still your current revision",
  provider_result: "Provider result recorded",
  authority: "Still within your permissions",
};

export function checkLabel(name: string): string {
  return CHECK_LABEL[name] ?? name;
}

export interface Attention {
  item: AssignmentSummary;
  eyebrow: string;
  title: string;
  body: string;
  action: string;
  href: string;
}

/**
 * The one timely thing for Home, in order: a proposal waiting on the person,
 * work that cannot continue without them, then prepared work awaiting
 * inspection. In-progress, waiting, unknown and approved work are never
 * presented as decisions.
 */
export function workAttention(items: AssignmentSummary[]): Attention | null {
  const decision = items.find((i) => phaseOf(i) === "decision");
  if (decision) {
    const run = currentRun(decision);
    const artifact = decisionArtifactId(decision);
    return {
      item: decision,
      eyebrow: "One decision for you",
      title:
        run?.state === "decision_stale"
          ? "A proposal is based on an older version."
          : "A proposed revision is waiting for your decision.",
      body:
        run?.state === "decision_stale"
          ? "Your edits are kept. Review it, or ask for a new proposal."
          : "Nothing is applied until you decide. Your saved version stays as it is.",
      action: "Review the change",
      href: artifact
        ? `/assignments/${decision.id}/artifacts/${artifact}`
        : `/assignments/${decision.id}`,
    };
  }
  const blocked = items.find((i) => phaseOf(i) === "blocked");
  if (blocked)
    return {
      item: blocked,
      eyebrow: "Needs you",
      title: "This work can’t continue on its own.",
      body:
        blocked.next_step ??
        "Saved results are kept. Open it to see what is missing.",
      action: "See what’s needed",
      href: `/assignments/${blocked.id}`,
    };
  const prepared = items.find((i) => phaseOf(i) === "prepared");
  if (prepared)
    return {
      item: prepared,
      eyebrow: "Ready for you",
      title: "Your prepared work is ready to inspect.",
      body: "Review it, edit anything, or ask for a revision. Nothing is approved or carried out until you decide.",
      action: "Open prepared work",
      href: `/assignments/${prepared.id}`,
    };
  return null;
}

export const isWorking = (i: AssignmentSummary) => phaseOf(i) === "working";

/** What was produced, in plain words, from saved artifacts when the detail read has them. */
export function completedSummary(a: AssignmentSummary | Assignment): string {
  const artifacts = "artifacts" in a ? a.artifacts : [];
  if (!artifacts.length)
    return a.latest_result ?? "Saved results are available.";
  const names = artifacts.map((x) => x.title.toLowerCase());
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `Prepared ${list}.`;
}

/** A short, readable title from the person's request: its first sentence, bounded. */
export function shortTitle(goal: string, max = 72): string {
  const text = goal.trim().replace(/\s+/g, " ");
  const first = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
  if (first.length <= max) return first.replace(/[.!?]$/, "");
  const cut = first.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}…`;
}
