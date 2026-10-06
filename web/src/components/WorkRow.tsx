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
import { StatusBadge } from "./ui";

/** One line of work: what it is, its status (same label on every surface), and where to go next. */
export function WorkRow({ item }: { item: AssignmentSummary }) {
  const phase = phaseOf(item);
  const review = decisionArtifactId(item);
  const run = currentRun(item);
  const href =
    phase === "decision" && review
      ? `/assignments/${item.id}/artifacts/${review}`
      : `/assignments/${item.id}`;
  const status = statusOf(item);
  const note =
    phase === "decision"
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
                ? "I can’t carry work forward on my own yet"
                : phase === "stopped" || phase === "paused"
                  ? "Saved results are kept"
                  : phase === "approved"
                    ? (item.latest_result ?? "")
                    : (item.next_step ?? item.latest_result ?? "");
  return (
    <li>
      <Link
        className="work-row"
        href={href}
        data-phase={phase}
        data-assignment={item.id}
      >
        <span className="work-row-main">
          <span className="work-row-title clamp-2">
            {shortTitle(item.title)}
          </span>
          <span className="work-row-status">
            <StatusBadge label={status.label} tone={status.tone} />
            {note ? <span className="work-row-note">{note}</span> : null}
          </span>
        </span>
        <span className="work-row-go" aria-hidden="true">
          ↗
        </span>
      </Link>
    </li>
  );
}
