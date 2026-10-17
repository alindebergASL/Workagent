"use client";
import Link from "next/link";
import { scopedHref } from "@/lib/scope";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useConversationReply } from "@/lib/client/conversation-reply";
import { useResource } from "@/lib/client/hooks";
import { conversationApi } from "@/lib/client/real-api";
import { ApiError, describeSendError } from "@/lib/contract/errors";
import type { ConversationDetailView } from "@/lib/contract/types";
import {
  recordedResponsibilities,
  type ExactTarget,
} from "@/lib/contract/natural";
import { holdGoal, useHolds } from "@/lib/client/responsibility";
import { shortTitle } from "@/lib/work-state";
import {
  adaptivePresentation,
  cardStatus,
  receiptSays,
  lastStopped,
  lastUnresolved,
  STOPPED_HINT,
  UNRESOLVED_HINT,
} from "@/lib/adaptive-presentation";
import { ErrorNotice } from "@/components/ui";
import { useExecution } from "@/lib/client/execution";
import { turnExecution, type ExecutionStatus } from "@/lib/execution-view";
import { AttachedFiles, SentFiles } from "@/components/AttachedFiles";
import {
  AgentReply,
  RuntimeRequest,
  TurnOutcome,
  TurnSummary,
  TurnProgressDetails,
  RecordingReceipts,
} from "@/components/TurnProgress";

const TURN_TEXT: Partial<Record<string, string>> = {
  queued: "Waiting for a reply.",
  responding: "Replying…",
  cancelled: "Stopped before a reply.",
  failed: "This didn’t complete.",
  unavailable: "Nothing has picked this up yet.",
  outcome_unknown:
    "Couldn’t confirm whether this finished. It won’t be sent again on its own; your saved work and edits are unchanged.",
  no_reply: "No reply was recorded.",
};

type Turn = ConversationDetailView["turns"][number];
/** Turns still waiting to be answered, which the service's check can explain. */
const pendingStates = new Set(["queued", "responding", "unavailable"]);

/** How an unresolved turn reads when its request is outside the pane. */
const EARLIER: Partial<Record<string, string>> = {
  queued: "is still waiting for a reply.",
  responding: "is still being answered.",
  cancelled: "was stopped before a reply.",
  failed: "didn’t complete.",
  unavailable: "hasn’t been picked up yet.",
  outcome_unknown: "has an outcome that couldn’t be confirmed.",
  no_reply: "has no recorded reply.",
};

/** One request's unresolved turn: its state and, when given, why. */
function PendingTurn({
  turn,
  execution,
}: {
  turn: Turn;
  execution?: ExecutionStatus | null;
}) {
  return (
    <div className="msg-pending" data-state={turn.state}>
      {turn.responsibility_origin ? (
        <p className="eyebrow-caps">Hand-over continuation</p>
      ) : null}
      <TurnSummary
        state={turn.state}
        progress={turn.progress}
        fallback={TURN_TEXT[turn.state]}
        execution={
          pendingStates.has(turn.state)
            ? turnExecution(turn.run_id, execution)
            : null
        }
      />
      {turn.reason &&
      (turn.state === "failed" ||
        turn.state === "unavailable" ||
        turn.state === "outcome_unknown") ? (
        <details className="ids-details">
          <summary>Why</summary>
          <p className="ids">{turn.reason}</p>
        </details>
      ) : null}
    </div>
  );
}

// An admitted turn whose consumer has not claimed it can still progress.
// Keep read-only polling; never resend or infer a successful result.
const awaitingReply = (t: Turn) =>
  t.state === "queued" ||
  t.state === "responding" ||
  t.state === "unavailable" ||
  t.state === "outcome_unknown";
const inFlight = (d: ConversationDetailView | null) =>
  Boolean(d?.turns.some(awaitingReply));

/**
 * The conversation this work came from, shown beside it: the latest
 * messages, the current turn's state, and a reply box. Replies use the same
 * draft and unconfirmed-send record as the full conversation, so a send whose
 * outcome is unknown can only be replayed exactly, from here or there. When a
 * turn settles, the work is re-read so a proposed change shows up.
 */
export function ConversationPeek({
  conversation: initial,
  wsId,
  refreshWork,
  target,
  unsavedEdits = false,
  about,
  placeholder = "Reply about this work…",
  eyebrow = "From the conversation",
  idleHint = "Ask about this work or ask for a change.",
  compact = false,
  held: heldByPage = false,
  paused,
}: {
  conversation: ConversationDetailView;
  /** The work shown beside this pane, if one is. */
  artifactId?: string;
  wsId: string;
  refreshWork: () => Promise<unknown>;
  /**
   * The exact saved version a reply is about. Null: deliberately about none
   * (a reply about the whole project). Undefined: this build can't name a
   * version, so a reply is held until sent deliberately as a general message.
   */
  target?: ExactTarget | null;
  /** Edits in the working copy that a reply does not include. */
  unsavedEdits?: boolean;
  /** What a reply is about, shown with the reply box. */
  about?: (pendingTarget: ExactTarget | null | undefined) => ReactNode;
  placeholder?: string;
  eyebrow?: string;
  idleHint?: string;
  /**
   * Fewer messages, each reply's recorded outcome and run details folded
   * away (the surrounding page says what needs the person).
   */
  compact?: boolean;
  /**
   * The page around this pane can't confirm what it shows (for example, a
   * project that can't be re-read); sending is held as if this pane couldn't.
   */
  held?: boolean;
  /**
   * Sending waits, for the reason given (shown by the reply box); drafting
   * goes on. For example, the work a reply is about is being re-read.
   */
  paused?: string;
}) {
  const cid = initial.conversation.id;
  const execution = useExecution(wsId);
  const res = useResource<ConversationDetailView>(
    `peek:${wsId}:${cid}`,
    (signal) => conversationApi.get(wsId, cid, signal),
    { pollMs: 2000, shouldPoll: (d) => inFlight(d) },
  );
  // A terminal read (no longer authorized, or gone) replaces everything that
  // was shown, including the snapshot this pane opened with.
  const revoked =
    res.error?.code === "not_found_or_not_authorized" ||
    res.error?.code === "unauthenticated";
  // A recoverable failure keeps a labelled snapshot, with sending held.
  const staleRead =
    heldByPage || res.reconnecting || Boolean(res.error && !res.data);
  const d = res.data ?? initial;
  const open = d.conversation.state === "open";
  // A turned-off activation never falls back: every send would be refused.
  const answersOff = d.conversation.model_activation === "revoked";
  // After a send, the work beside this pane is re-read too: a project's
  // standing depends on the new turn.
  const refreshConversation = res.refresh;
  const refreshBoth = useCallback(
    () => Promise.all([refreshConversation(), refreshWork()]),
    [refreshConversation, refreshWork],
  );
  const reply = useConversationReply({
    wsId,
    cid,
    version: d.conversation.work_version,
    refresh: refreshBoth,
    target,
    // Files go with a reply only where a reply names its exact version.
    attach: target !== undefined,
    // Admission, not just the button: no key or retry sends while held.
    held:
      revoked ||
      staleRead ||
      !open ||
      answersOff ||
      Boolean(paused) ||
      Boolean(d && lastUnresolved(d.turns)),
  });

  // Any turn that settles after this pane opened may carry new work, even
  // one that finished before a waiting state was ever seen here.
  const settledKey = (t: ConversationDetailView["turns"][number]) =>
    `${t.run_id}:${t.state}`;
  const seen = useRef<Set<string> | null>(null);
  seen.current ??= new Set(
    initial.turns
      .filter((t) => t.state !== "queued" && t.state !== "responding")
      .map(settledKey),
  );
  const settled = d.turns
    .filter((t) => t.state !== "queued" && t.state !== "responding")
    .map(settledKey)
    .join("|");
  useEffect(() => {
    const known = seen.current!;
    const fresh = settled.split("|").filter((k) => k && !known.has(k));
    if (!fresh.length) return;
    fresh.forEach((k) => known.add(k));
    void refreshWork();
  }, [settled, refreshWork]);

  // Without an exact saved version (older services), a reply here can't
  // name the version it's about. It is held until the person sends it
  // deliberately as a general message; it never goes by Enter or submit.
  const unlinked = target === undefined;
  const recent = d.messages.slice(compact ? -6 : -8);
  // Each request's own turn shows under it. A turn that isn't resolved and
  // whose request isn't shown here still gets a line: the latest in full
  // (it may have no request to anchor to), older ones as a link into the
  // full conversation.
  const unresolved = (t: Turn) =>
    t.state !== "replied" && Boolean(TURN_TEXT[t.state]);
  const shownIds = new Set(recent.map((m) => m.id));
  // Current goals for the responsibilities recorded in view, so links name
  // the work; a bounded, read-only read.
  const recordedIds = d.turns.flatMap((t) =>
    recordedResponsibilities(t.progress).map((r) => r.assignment_id),
  );
  const { holds } = useHolds(revoked ? null : wsId, recordedIds);
  const names = Object.fromEntries(
    recordedIds.map((id) => {
      const goal = holdGoal(holds[id]);
      return [id, goal ? shortTitle(goal) : undefined];
    }),
  );
  const turnOf = (m: ConversationDetailView["messages"][number]) =>
    m.author === "agent"
      ? null
      : (d.turns.find((t) => t.message_id === m.id) ?? null);
  const unanchored = d.turns.filter(
    (t) => unresolved(t) && !(t.message_id && shownIds.has(t.message_id)),
  );
  const last = d.turns.at(-1);
  const lastUnanchored = last && unanchored.includes(last) ? last : null;
  const earlier = unanchored.filter((t) => t !== lastUnanchored);
  if (revoked)
    return (
      <div className="agent-pane conversation stack">
        <p className="eyebrow-caps">{eyebrow}</p>
        <p className="notice-line" role="status" data-testid="peek-revoked">
          This conversation isn’t available to you any more, so nothing from it
          is shown here.
        </p>
      </div>
    );
  return (
    <div
      className={`agent-pane conversation stack${compact ? " compact" : ""}`}
    >
      <p className="eyebrow-caps">{eyebrow}</p>
      {about ? null : (
        <p className="small muted clamp-2">{d.conversation.title}</p>
      )}
      <ol className="thread" aria-label="Recent conversation">
        {recent.map((m) => (
          <li key={m.id} className={`msg msg-${m.author}`}>
            {m.author === "agent" ? (
              <div
                className="agent-presence agent-presence-xs"
                aria-hidden="true"
              />
            ) : null}
            <div className="stack-sm">
              {m.author === "agent" ? (
                <AgentReply
                  recordedInDetails
                  text={m.text}
                  budget={280}
                  progress={
                    d.turns.find((t) => t.run_id === m.run_id)?.progress
                  }
                />
              ) : m.author === "runtime" ? (
                <RuntimeRequest
                  text={m.text}
                  origin={m.responsibility_origin}
                />
              ) : (
                <p>
                  <span className="sr-only">You: </span>
                  {m.text}
                </p>
              )}
              {m.author === "person" ? (
                <SentFiles files={m.attachments} />
              ) : null}
              {(() => {
                if (m.author !== "agent") return null;
                const turnNow = d.turns.find((t) => t.run_id === m.run_id);
                const state = turnNow?.state ?? "replied";
                const view = adaptivePresentation(state, turnNow?.progress);
                // Beside the work, how far it was checked and what was
                // recorded are routine: they sit under Details. Anything
                // else (stopped, blocked, needs input) stays in view.
                const routine =
                  state === "replied" &&
                  (cardStatus(view) !== null || receiptSays(view));
                const inline = !compact && !routine;
                return (
                  <>
                    {inline ? (
                      <TurnOutcome state={state} progress={turnNow?.progress} />
                    ) : null}
                    <RecordingReceipts
                      progress={turnNow?.progress}
                      names={names}
                    />
                    <div className="msg-meta row wrap">
                      <TurnProgressDetails
                        origin={m.origin}
                        progress={turnNow?.progress}
                        recorded={m.text}
                        outcome={inline ? null : view}
                      />
                    </div>
                  </>
                );
              })()}
              {(() => {
                const turn = turnOf(m);
                return turn ? (
                  <>
                    {unresolved(turn) ? (
                      <PendingTurn turn={turn} execution={execution.data} />
                    ) : null}
                    {/* With no reply (yet, or ever), the receipt shows here. */}
                    {!d.messages.some(
                      (x) => x.author === "agent" && x.run_id === turn.run_id,
                    ) ? (
                      <RecordingReceipts
                        progress={turn.progress}
                        names={names}
                      />
                    ) : null}
                  </>
                ) : null;
              })()}
            </div>
          </li>
        ))}
      </ol>
      {earlier.length ? (
        <ul className="small peek-earlier" data-testid="peek-earlier">
          {earlier.map((t) => (
            <li key={t.run_id} data-state={t.state}>
              {t.responsibility_origin
                ? "An earlier hand-over continuation"
                : "An earlier request"}{" "}
              {EARLIER[t.state]}{" "}
              <Link
                href={scopedHref(`/conversations/${cid}#run-${t.run_id}`, wsId)}
              >
                See it in the conversation
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {staleRead ? (
        <p className="msg-pending" role="status" data-state="reconnecting">
          Can’t reach the conversation right now. Showing what was last read;
          sending waits until it reconnects.
        </p>
      ) : null}
      {lastUnanchored ? (
        <PendingTurn turn={lastUnanchored} execution={execution.data} />
      ) : null}
      {paused && !staleRead ? (
        <p className="msg-pending" role="status" data-state="paused">
          {paused}
        </p>
      ) : null}
      {open ? (
        <form
          className="ask peek-ask"
          onSubmit={(e) => {
            e.preventDefault();
            // An unlinked reply goes only by its own explicit button.
            if (!unlinked) void reply.send();
          }}
        >
          <label htmlFor="peek-reply" className="sr-only">
            {placeholder.replace(/…$/, "")}
          </label>
          {about ? about(reply.pendingTarget) : null}
          <textarea
            id="peek-reply"
            value={reply.text}
            onChange={(e) => reply.setText(e.target.value)}
            placeholder={placeholder}
            rows={2}
            disabled={reply.sending || reply.uncertain}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!unlinked) void reply.send();
              }
            }}
          />
          {target !== undefined ? (
            <AttachedFiles
              files={reply.files}
              error={reply.fileError}
              locked={reply.filesLocked}
              onAdd={(list) => void reply.addFiles(list)}
              onRemove={reply.removeFile}
            />
          ) : null}
          {reply.error instanceof ApiError && reply.error.isVersionConflict ? (
            <p className="hint" role="status">
              This conversation changed since you looked. Your message is kept;
              send it again to add it after what’s new.
            </p>
          ) : reply.error ? (
            <ErrorNotice
              error={reply.error}
              describe={(e) =>
                describeSendError(e, d.conversation.model_activation)
              }
            />
          ) : null}
          {answersOff ? (
            <p className="notice-line small" data-testid="peek-answers-off">
              Answers are turned off for this conversation. New messages can’t
              be sent; your draft is kept.
            </p>
          ) : null}
          {unlinked ? (
            <p className="notice-line small" data-testid="peek-unlinked">
              Replies from here can’t be linked to this saved version, and files
              can’t be attached here. Your draft is kept: send it to the
              conversation as a general message, or continue in the full
              conversation.
            </p>
          ) : null}
          <div className="ask-bar">
            <span className="hint">
              {reply.uncertain
                ? "Your last send wasn’t confirmed. Sending again replays the same message."
                : lastUnresolved(d.turns)
                  ? UNRESOLVED_HINT
                  : target && unsavedEdits
                    ? "Your unsaved edits aren’t included. Replies work from your saved version."
                    : unlinked
                      ? "Nothing is sent until you choose to."
                      : lastStopped(d.turns)
                        ? STOPPED_HINT
                        : idleHint}
              {!reply.uncertain && lastUnresolved(d.turns) ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="link-quiet small"
                    data-testid="unresolved-check"
                    onClick={() => void refreshBoth()}
                  >
                    Check again
                  </button>
                </>
              ) : null}
            </span>
            {unlinked ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void reply.send()}
                disabled={!reply.canSend}
              >
                {reply.uncertain
                  ? "Retry the same message"
                  : "Send without linking this version"}
              </button>
            ) : (
              <button
                type="submit"
                className="send-round"
                aria-label="Send"
                title="Send"
                disabled={!reply.canSend}
              >
                <span aria-hidden="true">↑</span>
              </button>
            )}
          </div>
        </form>
      ) : (
        <p className="hint">
          This conversation has ended. Its history is kept.
        </p>
      )}
      <Link
        className="link-quiet small"
        href={scopedHref(`/conversations/${cid}`, wsId)}
      >
        Open the full conversation
      </Link>
    </div>
  );
}
