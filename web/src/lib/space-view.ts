import { turnExecution, type ExecutionStatus } from "./execution-view";
import type { ConversationDetailView } from "./contract/types";
import type { HoldEntry } from "./client/responsibility";
import { holdGoal } from "./client/responsibility";
import { holdGroup, holdStatus } from "./hold-view";
import { flexibleKind, isFlexible, KIND_LABEL } from "./flexible";
import { shortTitle } from "./work-state";
import type { S } from "./client/products";

/** One saved piece of a project's work, as last read. */
export interface SpaceWorkItem {
  artifact: S["Artifact"];
  /** Proposed changes waiting for the person, from the proposal records. */
  pending: S["Proposal"][];
}

export type Tone = "attention" | "working" | "quiet";

/**
 * Proposed changes made from the current saved version: they can be applied.
 * One made from an earlier version is outdated; it can only be dismissed
 * (or remade), never applied as is.
 */
export const actionable = (item: SpaceWorkItem) =>
  item.pending.filter(
    (p) => p.base_revision_id === item.artifact.current_revision_id,
  );
export const outdated = (item: SpaceWorkItem) =>
  item.pending.filter(
    (p) => p.base_revision_id !== item.artifact.current_revision_id,
  );

/** Something about the project worth saying, with where to act on it. */
export interface StandingLine {
  key: string;
  text: string;
  /** A quieter second line, when there's more to say. */
  detail?: string;
  tone: Tone;
  href?: string;
  action?: string;
}

/** What the project is made of right now, and what (if anything) needs the person. */
export interface SpaceStanding {
  /** The one next step, said plainly. */
  next: StandingLine;
  /** Everything that needs the person, most pressing first. */
  needs: StandingLine[];
  /** Work underway that needs nothing from the person. */
  underway: StandingLine[];
}

type Turn = ConversationDetailView["turns"][number];

const waiting = (t: Turn) => t.state === "queued" || t.state === "responding";
const doubtful = (t: Turn) =>
  t.state === "outcome_unknown" || t.state === "unavailable";

export function workTitle(artifact: S["Artifact"]): string {
  const body = artifact.current_revision.body as { title?: string };
  return body.title?.trim() || "Untitled work";
}

/** What kind of thing a piece of work is, in a word. */
export function workKind(artifact: S["Artifact"]): string {
  const body = artifact.current_revision.body;
  if (isFlexible(body)) {
    const kind = flexibleKind(body);
    return kind ? KIND_LABEL[kind] : "Work";
  }
  const kind = (body as { kind?: string }).kind;
  return kind === "table"
    ? "Table"
    : kind === "tool"
      ? "Tool"
      : kind === "file"
        ? "File"
        : "Work";
}

/**
 * Whether a reply can name this work as its subject: the kinds the service
 * accepts as an exact target (tables, tools and self-describing work). A
 * saved file can be read and opened, but a reply about it goes to the project.
 */
export function canAskAbout(artifact: S["Artifact"]): boolean {
  const body = artifact.current_revision.body;
  if (isFlexible(body)) return true;
  const kind = (body as { kind?: string }).kind;
  return kind === "table" || kind === "tool";
}

export const workHref = (cid: string, aid: string) =>
  `/conversations/${encodeURIComponent(cid)}/artifacts/${encodeURIComponent(aid)}`;

/**
 * The work to show first: one with a change waiting for review, otherwise
 * the most recently changed. Never a guess about importance.
 */
export function leadWork(items: SpaceWorkItem[]): SpaceWorkItem | null {
  if (!items.length) return null;
  const changed = (i: SpaceWorkItem) =>
    Date.parse(i.artifact.current_revision.created_at ?? "") || 0;
  return (
    [...items].sort(
      (a, b) =>
        Number(actionable(b).length > 0) - Number(actionable(a).length > 0) ||
        changed(b) - changed(a),
    )[0] ?? null
  );
}

/**
 * Where a project stands, from its saved records only: proposals waiting for
 * review, responsibilities by their current lifecycle, and the latest
 * request's turn. Nothing here is inferred from reply text, and an unreadable
 * part is said as such rather than as "nothing".
 */
export function spaceStanding({
  detail,
  work,
  workUnreadable = false,
  holds,
  execution,
}: {
  detail: ConversationDetailView;
  work: SpaceWorkItem[] | null;
  workUnreadable?: boolean;
  holds: Record<string, HoldEntry | undefined>;
  /** The service's check of what's running, when read. */
  execution?: ExecutionStatus | null;
}): SpaceStanding {
  const cid = detail.conversation.id;
  const needs: StandingLine[] = [];
  const underway: StandingLine[] = [];

  for (const item of work ?? []) {
    const ready = actionable(item).length;
    if (!ready) continue;
    const title = workTitle(item.artifact);
    needs.push({
      key: `review:${item.artifact.id}`,
      text:
        ready === 1
          ? `A change to “${title}” is waiting for your review.`
          : `${ready} changes to “${title}” are waiting for your review.`,
      tone: "attention",
      href: workHref(cid, item.artifact.id),
      action: `Review the change to ${title}`,
    });
  }
  for (const item of work ?? []) {
    const old = outdated(item).length;
    if (!old) continue;
    const title = workTitle(item.artifact);
    needs.push({
      key: `outdated:${item.artifact.id}`,
      text:
        old === 1
          ? `A proposed change to “${title}” was made for an earlier version, so it can’t be applied as is.`
          : `${old} proposed changes to “${title}” were made for an earlier version, so they can’t be applied as is.`,
      detail: "You can dismiss it, or ask for the change again.",
      tone: "attention",
      href: workHref(cid, item.artifact.id),
      action: `Look at the change to ${title}`,
    });
  }

  for (const aid of detail.assignment_ids) {
    const entry = holds[aid];
    const status = holdStatus(entry);
    const goal = holdGoal(entry);
    const name = goal ? `“${shortTitle(goal, 60)}”` : "A hand-over";
    const line = (tone: Tone): StandingLine => ({
      key: `hold:${aid}`,
      text: status ? `${name}: ${status.label}.` : name,
      ...(status?.note ? { detail: status.note } : {}),
      tone,
      href: `/assignments/${encodeURIComponent(aid)}`,
      action: "See where it stands",
    });
    const group = holdGroup(entry);
    if (group === "attention") needs.push(line("attention"));
    else if (group === "holding") underway.push(line("quiet"));
    else if (entry?.kind === "unknown" || entry?.kind === "denied")
      underway.push(line("quiet"));
  }

  const last = detail.turns.at(-1);
  if (last && doubtful(last))
    needs.push({
      key: `turn:${last.run_id}`,
      text:
        last.state === "unavailable"
          ? "Your latest message hasn’t been picked up yet."
          : "Couldn’t confirm whether your latest message finished. Check the work before asking again.",
      tone: "attention",
    });
  else if (
    last &&
    last.state === "failed" &&
    // A turn that kept a result saved work; the work list says what.
    !last.progress?.retained_local_result
  )
    needs.push({
      key: `turn:${last.run_id}`,
      text: "Your latest message didn’t complete. The conversation says what happened.",
      tone: "attention",
    });
  else if (last && waiting(last)) {
    // Never "replying" when the service says nothing is running it.
    const run = turnExecution(last.run_id, execution);
    underway.push({
      key: `turn:${last.run_id}`,
      text: run?.replaces
        ? `Your latest message is waiting. ${run.text}`
        : last.state === "queued"
          ? "Your latest message is waiting for Workagent."
          : "Workagent is replying to your latest message.",
      tone: run?.replaces ? "attention" : "working",
    });
  }

  const lead = work ? leadWork(work) : null;
  const next: StandingLine =
    needs[0] ??
    (last && waiting(last)
      ? {
          key: "next:wait",
          text: "Nothing needs you while Workagent replies. You can keep working.",
          tone: "working",
        }
      : workUnreadable && !work
        ? {
            key: "next:unread",
            text: "Couldn’t read this project’s work right now. Your draft is kept.",
            tone: "attention",
          }
        : !work && detail.artifact_ids.length
          ? {
              key: "next:reading",
              text: "Checking where this project’s work stands…",
              tone: "quiet",
            }
          : lead
            ? {
                key: "next:open",
                text: `Continue with “${workTitle(lead.artifact)}”, or ask for a change.`,
                tone: "quiet",
                href: workHref(cid, lead.artifact.id),
                action: `Open ${workTitle(lead.artifact)}`,
              }
            : {
                key: "next:start",
                text: "Tell Workagent what you need for this project to get started.",
                tone: "quiet",
              });
  return { next, needs, underway };
}

/**
 * What a proposed change does, in plain words, from the two saved bodies
 * themselves (never from a model's description). Null when it can't be said
 * simply; the full comparison is on the work's own page.
 */
export function proposalSummary(
  current: S["Artifact"]["current_revision"]["body"],
  proposed: S["Proposal"]["body"],
): string | null {
  type Row = { row_id: string; cells: { field_key: string; value: unknown }[] };
  type Table = { kind?: string; fields: { key: string }[]; rows: Row[] };
  type Doc = { blocks: { block_id: string; text: string }[] };
  const isTable = (b: unknown): b is Table =>
    (b as Table)?.kind === "structured_table";
  const isDoc = (b: unknown): b is Doc =>
    Array.isArray((b as Doc)?.blocks) && !(b as Table).kind;
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  if (isTable(current) && isTable(proposed)) {
    const before = new Map(current.rows.map((r) => [r.row_id, r]));
    const after = new Map(proposed.rows.map((r) => [r.row_id, r]));
    const first = (r: Row) => {
      const v = r.cells.find(
        (c) => c.field_key === proposed.fields[0]?.key,
      )?.value;
      return typeof v === "string" || typeof v === "number" ? String(v) : null;
    };
    const added = proposed.rows.filter((r) => !before.has(r.row_id));
    const removed = current.rows.filter((r) => !after.has(r.row_id));
    const changed = proposed.rows.filter(
      (r) =>
        before.has(r.row_id) &&
        JSON.stringify(before.get(r.row_id)!.cells) !== JSON.stringify(r.cells),
    );
    const parts: string[] = [];
    if (added.length)
      parts.push(
        added.length === 1 && first(added[0]!)
          ? `adds a row: ${first(added[0]!)}`
          : `adds ${plural(added.length, "row", "rows")}`,
      );
    if (changed.length)
      parts.push(`changes ${plural(changed.length, "row", "rows")}`);
    if (removed.length)
      parts.push(`removes ${plural(removed.length, "row", "rows")}`);
    if (JSON.stringify(current.fields) !== JSON.stringify(proposed.fields))
      parts.push("changes the columns");
    return parts.length
      ? `It ${parts.join(", ").replace(/, ([^,]*)$/, " and $1")}.`
      : null;
  }
  if (isDoc(current) && isDoc(proposed)) {
    const before = new Map(current.blocks.map((b) => [b.block_id, b.text]));
    const ids = new Set(proposed.blocks.map((b) => b.block_id));
    const added = proposed.blocks.filter((b) => !before.has(b.block_id)).length;
    const changed = proposed.blocks.filter(
      (b) => before.has(b.block_id) && before.get(b.block_id) !== b.text,
    ).length;
    const removed = current.blocks.filter((b) => !ids.has(b.block_id)).length;
    const parts: string[] = [];
    if (changed) parts.push(`rewrites ${plural(changed, "part", "parts")}`);
    if (added) parts.push(`adds ${plural(added, "part", "parts")}`);
    if (removed) parts.push(`removes ${plural(removed, "part", "parts")}`);
    return parts.length
      ? `It ${parts.join(", ").replace(/, ([^,]*)$/, " and $1")}.`
      : null;
  }
  return null;
}
