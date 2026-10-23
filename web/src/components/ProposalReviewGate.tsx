"use client";

import { type Acks, type Review, removedLabel } from "@/lib/proposal-review";

/**
 * Before a proposal can replace the saved version: what it would take out,
 * in full, and an unticked acknowledgement for each risk it carries.
 */
export function ProposalReviewGate({
  review,
  acks,
  setAcks,
  disabled,
}: {
  review: Review;
  acks: Acks;
  setAcks: (next: Acks) => void;
  disabled: boolean;
}) {
  if (!review.needsRemovalAck && !review.needsOlderAck) return null;
  const unlisted = review.removedCount - review.removed.length;
  return (
    <div className="stack-sm proposal-gate" data-testid="proposal-gate">
      {review.needsRemovalAck ? (
        <>
          <p className="small" role="note" data-testid="proposal-removes">
            <strong>
              Applying this removes or replaces {review.removedCount} saved{" "}
              {review.removedCount === 1 ? "value" : "values"} or content.
            </strong>
            {unlisted > 0 ? (
              <>
                {" "}
                Only {review.removed.length} are listed here; compare the full
                versions before accepting.
              </>
            ) : null}
          </p>
          <details className="ids-details" open={review.removed.length <= 3}>
            <summary>What it removes or replaces</summary>
            <ul
              className="small proposal-removed"
              data-testid="proposal-removed"
            >
              {review.removed.map((r) => (
                <li key={r.path}>
                  <span className="muted">{removedLabel(r.path)}:</span>{" "}
                  {r.before || <span className="muted">(empty)</span>}
                </li>
              ))}
              {unlisted > 0 ? (
                <li className="muted">…and {unlisted} more not listed here</li>
              ) : null}
            </ul>
          </details>
          <label className="small row">
            <input
              type="checkbox"
              checked={acks.removed}
              disabled={disabled}
              data-testid="ack-removed"
              onChange={(e) => setAcks({ ...acks, removed: e.target.checked })}
            />{" "}
            I understand this removes or replaces the saved content above
          </label>
        </>
      ) : null}
      {review.needsOlderAck ? (
        <label className="small row">
          <input
            type="checkbox"
            checked={acks.older}
            disabled={disabled}
            data-testid="ack-older"
            onChange={(e) => setAcks({ ...acks, older: e.target.checked })}
          />{" "}
          Apply this earlier proposal instead of the latest one
        </label>
      ) : null}
    </div>
  );
}
