"use client";
import Link from "next/link";
import { phaseOf, shortTitle } from "@/lib/work-state";
import type { AssignmentSummary } from "@/lib/contract/types";
import { assignmentStatus, StatusBadge } from "./ui";

/** One line of work: what it is, its status (same label on every surface), and where to go next. */
export function WorkRow({ item }: { item: AssignmentSummary }) {
  const phase = phaseOf(item);
  const review = item.needs_review_artifact_ids[0];
  const href =
    phase === "decision" && review
      ? `/assignments/${item.id}/artifacts/${review}`
      : `/assignments/${item.id}`;
  const status = assignmentStatus(item.state, item.stage);
  const note =
    phase === "decision"
      ? "A proposed revision needs your decision"
      : phase === "working"
        ? "Results appear as they’re saved"
        : phase === "stopped"
          ? "Saved results are kept"
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
