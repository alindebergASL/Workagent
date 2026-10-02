"use client";
import Link from "next/link";
import {
  phaseOf,
  reviewIds,
  shortTitle,
  type WorkItem,
} from "@/lib/work-state";

/** One line of work: what it is, where it stands, and the one place to go next. */
export function WorkRow({ item }: { item: WorkItem }) {
  const phase = phaseOf(item);
  const { summary, detail } = item;
  const review = reviewIds(item)[0];
  const href =
    phase === "decision" && review
      ? `/assignments/${summary.id}/artifacts/${review}`
      : `/assignments/${summary.id}`;
  const status =
    phase === "decision"
      ? "A proposed change needs your decision"
      : phase === "blocked"
        ? (detail?.unresolved[0] ?? "Needs your input to continue")
        : phase === "working"
          ? `${detail?.stage ?? summary.stage ?? "In progress"} · results appear as they’re saved`
          : phase === "stopped"
            ? "Stopped · saved results are kept"
            : phase === "prepared"
              ? "Ready for review · open prepared work"
              : "Approved revision · task and responsibility completion not implied";
  return (
    <li>
      <Link className="work-row" href={href} data-phase={phase}>
        <span className="work-row-main">
          <span className="work-row-title clamp-2">
            {shortTitle(summary.title)}
          </span>
          <span className="work-row-status">{status}</span>
        </span>
        <span className="work-row-go" aria-hidden="true">
          ↗
        </span>
      </Link>
    </li>
  );
}
