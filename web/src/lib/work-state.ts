import type { AssignmentSummary } from "./contract/types";

/** Home and Spaces derive attention from persisted domain state, never demo flags. */
export function workAttention(items: AssignmentSummary[]) {
  const review = items.find(
    (item) => item.needs_review_artifact_ids.length > 0,
  );
  if (review)
    return {
      assignment: review,
      title: "A proposed change needs your decision",
      action: "Review changes",
      href: `/assignments/${review.id}/artifacts/${review.needs_review_artifact_ids[0]}`,
    };
  const ready = items.find((item) => item.state === "ready_for_review");
  if (ready)
    return {
      assignment: ready,
      title: "Your work is ready to inspect",
      action: "Open prepared work",
      href: `/assignments/${ready.id}`,
    };
  const blocked = items.find(
    (item) => item.state === "needs_input" || item.state === "failed",
  );
  if (blocked)
    return {
      assignment: blocked,
      title: "This work needs attention",
      action: "Inspect next step",
      href: `/assignments/${blocked.id}`,
    };
  const working = items.find(
    (item) => item.state === "queued" || item.state === "working",
  );
  if (working)
    return {
      assignment: working,
      title: "Your request is in progress",
      action: "Inspect progress",
      href: `/assignments/${working.id}`,
    };
  return null;
}
