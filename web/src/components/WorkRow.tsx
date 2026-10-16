"use client";
import Link from "next/link";
import {
  currentRun,
  decisionArtifactId,
  phaseOf,
  shortTitle,
  statusOf,
  waitingSummary,
} from "@/lib/work-state";
import type { AssignmentSummary } from "@/lib/contract/types";
import type { HoldEntry } from "@/lib/client/responsibility";
import { holdStatus } from "@/lib/hold-view";
import { responsibilityView } from "@/lib/responsibility-view";
import { scopedHref } from "@/lib/scope";
import { StatusBadge } from "./ui";

/**
 * One line of work: what it is, its status (same label on every surface), and
 * where to go next. When its responsibility was read, that current record
 * decides the status, not the assignment's coarse state.
 */
export function WorkRow({
  item,
  hold,
}: {
  item: AssignmentSummary;
  hold?: HoldEntry;
}) {
  const held = holdStatus(hold);
  const phase = phaseOf(item);
  const review = decisionArtifactId(item);
  const run = currentRun(item);
  const href = scopedHref(
    phase === "decision" && review
      ? `/assignments/${item.id}/artifacts/${review}`
      : `/assignments/${item.id}`,
    item.workspace_id,
  );
  const status = held ?? statusOf(item);
  const note = held
    ? held.note
    : phase === "decision"
      ? run?.state === "decision_stale"
        ? "A proposal is based on an older version"
        : "A proposed revision needs your decision"
      : phase === "unknown"
        ? "Waiting to confirm what happened"
        : phase === "waiting"
          ? waitingSummary(run)
          : phase === "unverified"
            ? "Couldn’t be verified, so it isn’t shown as done"
            : phase === "working"
              ? "Results appear as they’re saved"
              : phase === "paused" && item.conversation_id
                ? "Open it to see where it stands"
                : phase === "stopped" || phase === "paused"
                  ? "Saved results are kept"
                  : phase === "approved"
                    ? (item.latest_result ?? "")
                    : (item.next_step ?? item.latest_result ?? "");
  // Steering sits beside a responsibility that is still held: say what to
  // change in its conversation, or pause, resume or stop it on its page.
  const steerable =
    hold?.kind === "ready" &&
    !responsibilityView(hold.detail.lifecycle).closed &&
    Boolean(item.conversation_id);
  const paused =
    hold?.kind === "ready" && hold.detail.lifecycle.state === "paused";
  const title = shortTitle(item.title);
  return (
    <li className={steerable ? "work-row-steerable" : undefined}>
      <Link
        className="work-row"
        href={href}
        data-phase={phase}
        data-assignment={item.id}
        data-hold={hold?.kind}
      >
        <span className="work-row-main">
          <span className="work-row-title clamp-2">{title}</span>
          {held?.next ? (
            <span className="work-row-next clamp-2" data-testid="hold-next">
              {held.next}
            </span>
          ) : null}
          <span className="work-row-status">
            <StatusBadge label={status.label} tone={status.tone} />
            {note ? <span className="work-row-note">{note}</span> : null}
          </span>
        </span>
        <span className="work-row-go" aria-hidden="true">
          ↗
        </span>
      </Link>
      {steerable ? (
        <div className="work-row-steer" data-testid="steer">
          <Link
            className="btn btn-sm"
            href={scopedHref(
              `/conversations/${item.conversation_id}#follow-up`,
              item.workspace_id,
            )}
            aria-label={`Steer “${title}” in its conversation`}
          >
            Steer
          </Link>
          <Link
            className="btn btn-sm btn-quiet"
            href={scopedHref(
              `/assignments/${item.id}#responsibility`,
              item.workspace_id,
            )}
            aria-label={`${paused ? "Resume" : "Pause"} or stop “${title}”`}
          >
            {paused ? "Resume or stop…" : "Pause or stop…"}
          </Link>
        </div>
      ) : null}
    </li>
  );
}
