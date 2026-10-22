"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { newCommandId } from "@/lib/client/api";
import { usePendingCommand } from "@/lib/client/pending-command";
import {
  controlResponsibility,
  type ControlIntent,
  type Responsibility,
  type ResponsibilityOperation,
} from "@/lib/client/responsibility";
import { useCurrentWorkspace, useScopedHref } from "@/lib/client/workspace";
import { ApiError } from "@/lib/contract/errors";
import { responsibilityView } from "@/lib/responsibility-view";
import { formatTime } from "@/lib/time";
import { ErrorNotice } from "./ui";

const LABEL: Record<ResponsibilityOperation, [string, string]> = {
  pause: ["Pause", "Pausing…"],
  resume: ["Resume", "Resuming…"],
  cancel: ["Stop", "Stopping…"],
  takeover: ["Take this back", "Taking it back…"],
};
const NOUN: Record<ResponsibilityOperation, string> = {
  pause: "pause",
  resume: "resume",
  cancel: "stop",
  takeover: "take this back",
};
const ACKED: Record<ResponsibilityOperation, string> = {
  pause: "The service confirmed the pause.",
  resume: "The service confirmed the resume.",
  cancel: "The service confirmed the stop. Saved results are kept.",
  takeover: "The service confirmed it’s back with you. Saved results are kept.",
};

/**
 * The newer of what was last read and what the service last acknowledged,
 * by work version. A reply is shown only when it is newer, and is then
 * labelled as not yet re-read.
 */
function latest(read: Responsibility, acked: Responsibility | null) {
  return acked && acked.assignment.work_version > read.assignment.work_version
    ? { detail: acked, fromReply: true }
    : { detail: read, fromReply: false };
}

/**
 * The canonical responsibility on this assignment: what is recorded, what it
 * waits on, and the steering it supports. Nothing here implies work is
 * running. Each command is compare-and-swap on the version on screen. A
 * command whose outcome is unknown is kept for this tab across reloads and
 * can only be retried exactly; no other command replaces it, and nothing is
 * resent automatically.
 */
export function ResponsibilityPanel({
  ws,
  detail: read,
  observedAt,
  stale,
  refresh,
  doneWhen,
}: {
  ws: string;
  detail: Responsibility;
  observedAt: string | null;
  stale: boolean;
  /** What finishes it, from the hand-over; kept with the details. */
  doneWhen?: string | null;
  /** Re-reads the assignment and its responsibility; true if both read. */
  refresh: () => Promise<boolean>;
}) {
  const { zone } = useCurrentWorkspace();
  const inScope = useScopedHref();
  const aid = read.assignment.id;
  const pending = usePendingCommand<ControlIntent>(
    `workagent:responsibility-control:${ws}:${aid}`,
  );
  const [acked, setAcked] = useState<Responsibility | null>(null);
  const shown = latest(read, acked);
  const view = responsibilityView(shown.detail.lifecycle);
  const [busy, setBusy] = useState<ResponsibilityOperation | null>(null);
  const [confirm, setConfirm] = useState<ResponsibilityOperation | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const unresolved = pending.current;

  async function send(intent: ControlIntent) {
    setBusy(intent.operation);
    setError(null);
    setNote(null);
    try {
      pending.set(intent);
      const reply = await controlResponsibility(ws, aid, intent);
      pending.clear(intent);
      setConfirm(null);
      setAcked(reply);
      const reread = await refresh();
      setNote(
        reread
          ? ACKED[intent.operation]
          : `${ACKED[intent.operation]} I couldn’t re-read its current state, so what’s shown is the service’s reply.`,
      );
    } catch (e) {
      setConfirm(null);
      if (!(e instanceof ApiError && e.isAmbiguousWrite)) {
        // A definite answer resolves the command; never rebase and resend.
        pending.clear(intent);
        if (e instanceof ApiError && e.isVersionConflict) {
          const reread = await refresh();
          setNote(
            reread
              ? "This changed since you looked. Its current state is shown now; choose again if you still want to."
              : "This changed since you looked, and I couldn’t re-read its current state. Check again before choosing.",
          );
          return;
        }
      }
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  function start(operation: ResponsibilityOperation) {
    if (pending.current) return; // Only the unresolved command may be retried.
    void send({
      command_id: newCommandId(),
      operation,
      expected_work_version: shown.detail.assignment.work_version,
    });
  }

  async function checkAgain() {
    setChecking(true);
    setNote(null);
    const ok = await refresh();
    setChecking(false);
    if (!ok) setNote("Couldn’t re-read its current state. Try again shortly.");
  }

  // Arriving from "Pause or stop…" on Home brings the controls into view
  // once they exist (the address's anchor resolves before they load).
  useEffect(() => {
    if (location.hash === "#responsibility")
      document.getElementById("responsibility")?.scrollIntoView();
  }, []);

  // Steering needs a current read and no command in doubt.
  const steerable = !stale && !unresolved && !shown.fromReply && !busy;
  const conversationId = shown.detail.assignment.conversation_id;
  const observedLine = (
    <p
      className={shown.fromReply || stale ? "hint" : "small muted"}
      data-testid="responsibility-observed"
    >
      {shown.fromReply
        ? "From the service’s reply; not re-read yet."
        : stale
          ? `Can’t reach the service. Showing what was read at ${observedAt ? formatTime(observedAt, zone) : "the last read"}; steering waits until it reconnects.`
          : observedAt
            ? `Checked ${formatTime(observedAt, zone)}.`
            : null}{" "}
      <button
        type="button"
        className="link-quiet small"
        onClick={() => void checkAgain()}
        disabled={checking}
      >
        {checking ? "Checking…" : "Check again"}
      </button>
    </p>
  );

  return (
    <section
      id="responsibility"
      className="card card-quiet responsibility stack-sm"
      aria-labelledby="responsibility-title"
      data-testid="responsibility"
    >
      <h2 id="responsibility-title">
        {view.checkingBack && view.checkIn && !view.checkInDue
          ? `Checks back ${formatTime(view.checkIn, zone)}`
          : view.state}
      </h2>
      {view.needsYou ? (
        <p className="responsibility-needs" data-testid="responsibility-needs">
          <strong>Needs you:</strong> {view.needsYou}
        </p>
      ) : null}
      {view.waiting ? (
        <p>
          <span className="muted">Waiting on </span>
          {view.waiting}
        </p>
      ) : null}
      {view.next || view.checkIn ? (
        <p data-testid="responsibility-next">
          {view.next ? (
            <>
              <span className="muted">Next </span>
              {view.next}
            </>
          ) : null}
          {view.checkIn && !(view.checkingBack && !view.checkInDue) ? (
            <span className="muted">
              {view.next ? " · " : ""}
              {view.checkInDue
                ? "Its check-in is due now."
                : `Checks back ${formatTime(view.checkIn, zone)}.`}
            </span>
          ) : null}
        </p>
      ) : null}
      {/* Run state up front only when it says something: queued, running,
          blocked or settled. "Nothing is running" is in Details. */}
      {view.executionMatters || view.closed ? (
        <p className="small" data-testid="responsibility-execution">
          {view.execution}
        </p>
      ) : null}
      {view.lines.length ? (
        <ul className="small responsibility-lines">
          {view.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}

      {/* A stale or reply-only read is said before the controls it holds;
          otherwise one quiet line with a re-read follows them. */}
      {shown.fromReply || stale ? observedLine : null}
      {unresolved ? (
        <div className="notice-line stack-sm" role="status">
          <p>
            Your request to {NOUN[unresolved.operation]} wasn’t confirmed
            {pending.restored ? " before this page reloaded" : ""}. Retrying
            sends the same request, so it can’t happen twice. Nothing else can
            be chosen until it’s resolved.
          </p>
          <div className="row">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void send(unresolved)}
              disabled={Boolean(busy)}
            >
              {busy ? "Retrying…" : `Retry: ${NOUN[unresolved.operation]}`}
            </button>
          </div>
        </div>
      ) : view.allowed.length ? (
        confirm ? (
          <div className="steer-confirm" role="group" aria-label="Confirm">
            <p className="small">
              {confirm === "cancel"
                ? "Stop this? Saved results are kept, but it can’t be resumed."
                : "Take this back? You’ll carry it from here; saved results are kept."}
            </p>
            <div className="row">
              <button
                type="button"
                className="btn btn-sm btn-danger-quiet"
                onClick={() => start(confirm)}
                disabled={!steerable}
              >
                {busy === confirm ? LABEL[confirm][1] : LABEL[confirm][0]}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-quiet"
                onClick={() => setConfirm(null)}
                disabled={Boolean(busy)}
              >
                Don’t {NOUN[confirm]}
              </button>
            </div>
          </div>
        ) : (
          <div className="row steer-row">
            {view.allowed.map((op) => (
              <button
                key={op}
                type="button"
                className={
                  op === "resume" ? "btn btn-primary btn-sm" : "btn btn-sm"
                }
                onClick={() =>
                  op === "cancel" || op === "takeover"
                    ? setConfirm(op)
                    : start(op)
                }
                disabled={!steerable}
              >
                {busy === op ? LABEL[op][1] : LABEL[op][0]}
              </button>
            ))}
            {conversationId ? (
              <Link
                className="btn btn-sm btn-quiet"
                href={inScope(
                  `/conversations/${conversationId}`,
                  shown.detail.assignment.workspace_id,
                )}
                data-testid="responsibility-tell"
              >
                Tell Workagent something
              </Link>
            ) : null}
          </div>
        )
      ) : null}
      {note ? (
        <p className="hint" role="status">
          {note}
        </p>
      ) : null}
      {shown.fromReply || stale ? null : observedLine}
      {error ? <ErrorNotice error={error} /> : null}
      {view.executionDetail || view.runId || view.reviewQueued || doneWhen ? (
        <details className="ids-details">
          <summary>Details</summary>
          <div className="stack-sm small">
            {!view.executionMatters && !view.closed ? (
              <p data-testid="responsibility-execution">{view.execution}</p>
            ) : null}
            {view.executionDetail ? (
              <p data-testid="responsibility-why">{view.executionDetail}</p>
            ) : null}
            {doneWhen ? (
              <p data-testid="done-when">
                <span className="muted">Done when </span>
                {doneWhen}
              </p>
            ) : null}
            {view.reviewQueued ? (
              <p>A readiness review is queued. That isn’t a run.</p>
            ) : null}
            {view.runId && shown.detail.assignment.conversation_id ? (
              <Link
                href={inScope(
                  `/conversations/${shown.detail.assignment.conversation_id}#run-${view.runId}`,
                  shown.detail.assignment.workspace_id,
                )}
                data-testid="responsibility-run"
              >
                See its run in the conversation
              </Link>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}
