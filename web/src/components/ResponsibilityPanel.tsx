"use client";
import { useRef, useState } from "react";
import { newCommandId } from "@/lib/client/api";
import {
  controlResponsibility,
  type Responsibility,
  type ResponsibilityOperation,
} from "@/lib/client/responsibility";
import { useWorkspace } from "@/lib/client/workspace";
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
const DONE: Record<ResponsibilityOperation, string> = {
  pause: "Paused.",
  resume: "Resumed. It is recorded as yours to carry forward again.",
  cancel: "Stopped. Saved results are kept.",
  takeover: "It’s back with you. Saved results are kept.",
};

/**
 * The canonical responsibility on this assignment: what is recorded, what it
 * waits on, and the steering it supports. Nothing here implies work is
 * running; each command is compare-and-swap on the version on screen and an
 * unconfirmed send keeps its exact command for a retry.
 */
export function ResponsibilityPanel({
  ws,
  detail,
  onChanged,
}: {
  ws: string;
  detail: Responsibility;
  onChanged: () => Promise<unknown> | void;
}) {
  const { zone } = useWorkspace();
  const view = responsibilityView(detail.lifecycle);
  const [busy, setBusy] = useState<ResponsibilityOperation | null>(null);
  const [confirm, setConfirm] = useState<ResponsibilityOperation | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const pending = useRef<{
    command_id: string;
    operation: ResponsibilityOperation;
    expected_work_version: number;
  } | null>(null);

  async function control(operation: ResponsibilityOperation) {
    setBusy(operation);
    setError(null);
    setDone(null);
    try {
      if (!pending.current || pending.current.operation !== operation)
        pending.current = {
          command_id: newCommandId(),
          operation,
          expected_work_version: detail.assignment.work_version,
        };
      await controlResponsibility(ws, detail.assignment.id, pending.current);
      pending.current = null;
      setConfirm(null);
      setDone(DONE[operation]);
      await onChanged();
    } catch (e) {
      if (!(e instanceof ApiError && e.isAmbiguousWrite)) {
        pending.current = null;
        if (e instanceof ApiError && e.isVersionConflict) await onChanged();
      }
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      className="card card-quiet responsibility stack-sm"
      aria-labelledby="responsibility-title"
      data-testid="responsibility"
    >
      <p className="eyebrow-caps">Responsibility</p>
      <h2 id="responsibility-title">{view.state}</h2>
      {view.notRunning ? (
        <p className="small" data-testid="responsibility-not-running">
          Recorded only. I can’t work on this on my own yet, so nothing runs in
          the background.
        </p>
      ) : null}
      <dl className="glance-list">
        <div>
          <dt>Outcome so far</dt>
          <dd>{view.outcome}</dd>
        </div>
        {view.next ? (
          <div>
            <dt>Next</dt>
            <dd>{view.next}</dd>
          </div>
        ) : null}
        {view.checkIn ? (
          <div>
            <dt>Check in</dt>
            <dd>
              {formatTime(view.checkIn, zone)}
              {view.checkInDue ? " · due now" : ""}
            </dd>
          </div>
        ) : null}
      </dl>
      {view.lines.length ? (
        <ul className="small responsibility-lines">
          {view.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
      {view.reviewQueued ? (
        <p className="hint">
          A review is queued for when work can run. It hasn’t run.
        </p>
      ) : null}
      {view.allowed.length ? (
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
                onClick={() => void control(confirm)}
                disabled={Boolean(busy)}
              >
                {busy === confirm ? LABEL[confirm][1] : LABEL[confirm][0]}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-quiet"
                onClick={() => setConfirm(null)}
                disabled={Boolean(busy)}
              >
                Keep it as it is
              </button>
            </div>
          </div>
        ) : (
          <div className="row">
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
                    : void control(op)
                }
                disabled={Boolean(busy)}
              >
                {busy === op ? LABEL[op][1] : LABEL[op][0]}
              </button>
            ))}
          </div>
        )
      ) : null}
      {done ? (
        <p className="hint" role="status">
          {done}
        </p>
      ) : null}
      {error instanceof ApiError && error.isVersionConflict ? (
        <p className="hint" role="status">
          This changed since you looked. Its current state is shown now; choose
          again if you still want to.
        </p>
      ) : error ? (
        <ErrorNotice
          error={error}
          actions={
            pending.current ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void control(pending.current!.operation)}
                disabled={Boolean(busy)}
              >
                Retry the same request
              </button>
            ) : undefined
          }
        />
      ) : null}
    </section>
  );
}
