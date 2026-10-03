"use client";
import { useRef, useState } from "react";
import { api, newCommandId } from "@/lib/client/api";
import { ApiError } from "@/lib/contract/errors";
import type {
  Assignment,
  ControlAssignmentCommand,
  ControlOperation,
} from "@/lib/contract/types";
import {
  currentRun,
  phaseOf,
  statusOf,
  waitingSummary,
  type WorkPhase,
} from "@/lib/work-state";
import { ErrorNotice } from "./ui";

/** Plain ownership lines, from recorded state only. Nothing here is a promise. */
function glance(a: Assignment, phase: WorkPhase) {
  const run = currentRun(a);
  const mine: Record<WorkPhase, string> = {
    working: "Preparing this from the context you chose.",
    waiting: waitingSummary(run),
    unknown: "Confirming what happened with the last request.",
    paused: a.conversation_id
      ? "Nothing yet. You handed this over, but I can’t carry work forward on my own yet."
      : "Nothing while this is paused.",
    decision: "Nothing new until you decide.",
    blocked: "Nothing until what’s missing is resolved.",
    prepared: "The prepared work is with you now.",
    approved: "Nothing further. I don’t carry out the next action.",
    stopped: "Nothing. This work was stopped.",
    unverified: "Nothing until the result can be checked.",
  };
  const waitingOn: Partial<Record<WorkPhase, string>> = {
    waiting: statusOf(a).label,
    unknown: "A recorded result for the last request",
    decision: "Your decision on the proposed change",
    blocked: a.unresolved[0] ?? "Something only you can provide",
    prepared: "Your review",
  };
  return {
    mine: mine[phase],
    waitingOn:
      phase === "paused" && a.conversation_id
        ? "The ability to start handed-over work on my own, which isn’t available yet"
        : (waitingOn[phase] ?? "Nothing"),
    yours:
      "Approving changes and any next action. Nothing is carried out without you.",
    doneWhen: a.completion_criteria,
  };
}

const VERB: Record<ControlOperation, string> = {
  pause: "Paused. Saved results are kept.",
  resume: "Resumed.",
  cancel: "Stopped. Saved results are kept.",
};

/**
 * What I own, what this waits on and what stays with the person, plus the
 * real steering commands. Each command is compare-and-swap on the work
 * version the person was looking at; an unconfirmed send keeps its exact
 * command so retrying can't act twice.
 */
export function Ownership({
  assignment: a,
  onChanged,
}: {
  assignment: Assignment;
  onChanged: () => Promise<unknown> | void;
}) {
  const phase = phaseOf(a);
  const g = glance(a, phase);
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState<ControlOperation | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const pending = useRef<ControlAssignmentCommand | null>(null);
  const stopRef = useRef<HTMLButtonElement>(null);

  const cancelled = a.lifecycle === "cancelled" || a.state === "stopped";
  const canPause =
    !cancelled &&
    a.lifecycle !== "paused" &&
    (phase === "working" || phase === "waiting");
  // A hand-over recorded from a conversation can't be resumed yet (B1).
  const handover = Boolean(a.conversation_id);
  const canResume = !cancelled && a.lifecycle === "paused" && !handover;
  const canStop =
    !cancelled &&
    (canPause || canResume || (handover && a.lifecycle === "paused"));

  const control = async (operation: ControlOperation) => {
    setBusy(operation);
    setError(null);
    setDone(null);
    try {
      if (!pending.current || pending.current.operation !== operation)
        pending.current = {
          command_id: newCommandId(),
          operation,
          expected_work_revision: a.work_revision,
        };
      await api.controlAssignment(a.workspace_id, a.id, pending.current);
      pending.current = null;
      setConfirmStop(false);
      setDone(VERB[operation]);
      await onChanged();
    } catch (e) {
      if (!(e instanceof ApiError && e.isAmbiguousWrite)) {
        pending.current = null;
        // A newer change exists: show the current state rather than overriding it.
        if (e instanceof ApiError && e.isVersionConflict) await onChanged();
      }
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card card-quiet glance" aria-labelledby="glance-title">
      <h2 id="glance-title">Ownership at a glance</h2>
      <dl className="glance-list">
        <div>
          <dt>I own</dt>
          <dd>{g.mine}</dd>
        </div>
        <div>
          <dt>Waiting on</dt>
          <dd>{g.waitingOn}</dd>
        </div>
        <div>
          <dt>You own</dt>
          <dd>{g.yours}</dd>
        </div>
        {g.doneWhen.length ? (
          <div>
            <dt>Done when</dt>
            <dd>{g.doneWhen.join(" ")}</dd>
          </div>
        ) : null}
      </dl>
      {canPause || canResume || canStop ? (
        <div className="steer">
          {confirmStop ? (
            <div className="steer-confirm" role="group" aria-label="Stop">
              <p className="small">
                Stop this work? Saved results are kept, but it can’t be resumed.
              </p>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-sm btn-danger-quiet"
                  onClick={() => void control("cancel")}
                  disabled={Boolean(busy)}
                >
                  {busy === "cancel" ? "Stopping…" : "Stop work"}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => {
                    setConfirmStop(false);
                    window.setTimeout(() => stopRef.current?.focus(), 0);
                  }}
                  disabled={Boolean(busy)}
                >
                  Keep it going
                </button>
              </div>
            </div>
          ) : (
            <div className="row">
              {canResume ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void control("resume")}
                  disabled={Boolean(busy)}
                >
                  {busy === "resume" ? "Resuming…" : "Resume"}
                </button>
              ) : null}
              {canPause ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void control("pause")}
                  disabled={Boolean(busy)}
                >
                  {busy === "pause" ? "Pausing…" : "Pause"}
                </button>
              ) : null}
              {canStop ? (
                <button
                  ref={stopRef}
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => setConfirmStop(true)}
                  disabled={Boolean(busy)}
                >
                  Stop…
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {done ? (
        <p className="hint" role="status">
          {done}
        </p>
      ) : null}
      {error instanceof ApiError && error.isVersionConflict ? (
        <p className="hint" role="status">
          This work changed since you looked. Its current state is shown now;
          choose again if you still want to.
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
