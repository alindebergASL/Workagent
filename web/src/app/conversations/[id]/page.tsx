"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { newCommandId } from "@/lib/client/api";
import { useResource } from "@/lib/client/hooks";
import { useConversationReply } from "@/lib/client/conversation-reply";
import { usePendingCommand } from "@/lib/client/pending-command";
import { conversationApi } from "@/lib/client/real-api";
import type { WorkspaceScope } from "@/lib/client/workspace";
import { scopedHref } from "@/lib/scope";
import { backTo, ScopedRecord } from "@/components/ScopedRecord";
import { useExecution } from "@/lib/client/execution";
import { turnExecution } from "@/lib/execution-view";
import { ExecutionLine } from "@/components/ExecutionLine";
import { resultState, useResultStates } from "@/lib/client/result-states";
import { resultLink } from "@/lib/result-links";
import { holdGoal, useHolds } from "@/lib/client/responsibility";
import { holdStatus } from "@/lib/hold-view";
import { recordedResponsibilities } from "@/lib/contract/natural";
import { shortTitle } from "@/lib/work-state";
import { ApiError, describeSendError } from "@/lib/contract/errors";
import type {
  ChatMessage,
  ConversationDetailView,
  TurnState,
} from "@/lib/contract/types";
import { WorkAreaHeader } from "@/components/WorkAreas";
import { OperationComposer } from "@/components/OperationComposer";
import { AttachedFiles, SentFiles } from "@/components/AttachedFiles";
import { CAPABILITIES } from "@/lib/client/capabilities";
import { ErrorNotice, StatusBadge } from "@/components/ui";
import { WorkCard } from "@/components/WorkCard";
import {
  adaptivePresentation,
  cardStatus,
  receiptSays,
  lastStopped,
  STOPPED_HINT,
} from "@/lib/adaptive-presentation";
import {
  AgentReply,
  RuntimeRequest,
  TurnOutcome,
  TurnProgressDetails,
  RecordingReceipts,
  TurnSummary,
  replyTag,
} from "@/components/TurnProgress";

const PENDING: Record<Exclude<TurnState, "replied">, string> = {
  queued: "Waiting for a reply. Nothing has been answered yet.",
  responding: "Replying…",
  cancelled: "Stopped before a reply. Your message is kept.",
  no_reply: "No reply was recorded for this message.",
  failed: "This didn’t complete. Your message is kept.",
  unavailable:
    "Nothing has picked this up yet. Your message is kept and runs once the local worker is running.",
  outcome_unknown:
    "The outcome couldn’t be confirmed. Check the saved work before trying again.",
};

/**
 * One conversation, from recorded state only: the person's messages, the
 * replies the worker committed, and each turn's actual state. Sending is a
 * compare-and-swap on the version last seen; an uncertain send keeps its
 * exact command so retrying can't post twice.
 */
export default function ConversationPage() {
  return (
    <ScopedRecord>{(scope) => <ConversationView scope={scope} />}</ScopedRecord>
  );
}

function ConversationView({ scope }: { scope: WorkspaceScope }) {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const { wsId } = scope;
  const res = useResource<ConversationDetailView>(
    wsId ? `conversation:${wsId}:${id}` : null,
    (signal) => conversationApi.get(wsId!, id, signal),
    {
      pollMs: 2000,
      shouldPoll: (d) =>
        !d ||
        d.turns.some(
          (t) =>
            t.state === "queued" ||
            t.state === "responding" ||
            t.state === "unavailable" ||
            t.state === "outcome_unknown",
        ),
    },
  );
  const d = res.data;
  const results = useResultStates(wsId, d?.messages);
  const execution = useExecution(wsId);
  const { holds } = useHolds(wsId, d?.assignment_ids ?? []);

  // ---- follow-up composer ----
  const reply = useConversationReply({
    wsId,
    cid: id,
    version: d?.conversation.work_version ?? null,
    refresh: res.refresh,
    attach: CAPABILITIES.naturalAdmission,
    // Sending waits for a confirmed current read: not while reconnecting,
    // before the first read, or once the conversation has ended. Drafting
    // and attaching go on; nothing is sent when it reconnects.
    held:
      res.reconnecting ||
      !res.data ||
      res.data.conversation.state !== "open" ||
      res.data.conversation.model_activation === "revoked",
  });
  const { text, setText, sending, send } = reply;
  const sendError = reply.error;
  // Unresolved commands survive a reload so retrying replays them exactly.
  const pendingKey = (kind: string) =>
    wsId ? `workagent:pending:${wsId}:conversation:${id}:${kind}` : null;
  const boxRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 56)}px`;
  }, [text]);

  // ---- explicit hand-over ----
  const [handoverOpen, setHandoverOpen] = useState(
    search.get("handover") === "1",
  );
  const [goal, setGoal] = useState<string | null>(null);
  const [doneWhen, setDoneWhen] = useState("");
  const [handing, setHanding] = useState(false);
  const [handError, setHandError] = useState<unknown>(null);
  const handCmd = usePendingCommand<{
    command_id: string;
    expected_work_version: number;
    goal: string;
    completion_criteria: string[];
  }>(pendingKey("handover"));
  const restoredHand = handCmd.restored ? handCmd.current : null;
  useEffect(() => {
    if (!restoredHand) return;
    setHandoverOpen(true);
    setGoal(restoredHand.goal);
    setDoneWhen(restoredHand.completion_criteria[0] ?? "");
  }, [restoredHand]);
  const firstAsk = d?.messages.find((m) => m.author === "person")?.text ?? "";
  const goalText = goal ?? firstAsk;

  const handOver = async () => {
    if (!wsId || !d || handing) return;
    if (!handCmd.current && (!goalText.trim() || !doneWhen.trim())) return;
    setHanding(true);
    setHandError(null);
    try {
      if (!handCmd.current)
        handCmd.set({
          command_id: newCommandId(),
          expected_work_version: d.conversation.work_version,
          goal: goalText.trim(),
          completion_criteria: [doneWhen.trim()],
        });
      await conversationApi.delegate(wsId, id, handCmd.current!);
      handCmd.set(null);
      setHandoverOpen(false);
      setDoneWhen("");
      await res.refresh();
    } catch (e) {
      if (!(e instanceof ApiError && e.isAmbiguousWrite)) {
        handCmd.set(null);
        if (e instanceof ApiError && e.isVersionConflict) await res.refresh();
      }
      setHandError(e);
    } finally {
      setHanding(false);
    }
  };

  // ---- end the conversation ----
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<unknown>(null);
  const endCmd = usePendingCommand<{
    command_id: string;
    expected_work_version: number;
  }>(pendingKey("end"));
  const end = async () => {
    if (!wsId || !d) return;
    setEnding(true);
    setEndError(null);
    try {
      if (!endCmd.current)
        endCmd.set({
          command_id: newCommandId(),
          expected_work_version: d.conversation.work_version,
        });
      await conversationApi.cancel(wsId, id, endCmd.current!);
      endCmd.set(null);
      setConfirmEnd(false);
      await res.refresh();
    } catch (e) {
      if (!(e instanceof ApiError && e.isAmbiguousWrite)) endCmd.set(null);
      setEndError(e);
    } finally {
      setEnding(false);
    }
  };

  const back = (
    <Link className="back-link" href={backTo(scope).href}>
      {backTo(scope).label}
    </Link>
  );
  if (res.error && !d)
    return (
      <div className="agent-col">
        {back}
        <ErrorNotice error={res.error} />
      </div>
    );
  if (!d)
    return (
      <div className="agent-col" aria-busy="true">
        {back}
        <div className="skeleton" style={{ width: "60%", height: "2em" }} />
      </div>
    );

  const open = d.conversation.state === "open";
  // Which turn recorded each responsibility, from the service's receipts.
  const recordedIn: Record<string, string> = {};
  for (const t of d.turns)
    for (const r of recordedResponsibilities(t.progress))
      recordedIn[r.assignment_id] ??= t.run_id;
  const names = Object.fromEntries(
    d.assignment_ids.map((aid) => {
      const goal = holdGoal(holds[aid]);
      return [aid, goal ? shortTitle(goal) : undefined];
    }),
  );
  const hasReply = (runId: string) =>
    d.messages.some((x) => x.author === "agent" && x.run_id === runId);
  const turnOf = (m: ChatMessage) =>
    d.turns.find((t) => t.message_id === m.id) ?? null;
  const inFlight = d.turns.some(
    (t) => t.state === "queued" || t.state === "responding",
  );
  const controlled = d.messages.some(
    (m) => m.author === "agent" && m.origin === "controlled_transport",
  );
  const uncertainSend = reply.uncertain;
  const endPending = Boolean(endCmd.current) && !ending;
  // The latest answer to show a piece of work previews it; earlier ones
  // refer to it in one line.
  const latestRef = new Map<string, string>();
  for (const m of d.messages)
    for (const p of m.products ?? []) latestRef.set(p.artifact_id, m.id);
  const history = (
    <>
      <ol className="thread" aria-label="Conversation">
        {d.messages.map((m) => {
          // A turn's state shows under the request that started it: the
          // person's message or the runtime's continuation request.
          const turn = m.author !== "agent" ? turnOf(m) : null;
          return (
            <li
              key={m.id}
              className="thread-turn"
              // The request that started a run is where links to it land.
              id={m.author !== "agent" ? `run-${m.run_id}` : undefined}
            >
              <div className={`msg msg-${m.author}`}>
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
                    const replied = m.author === "agent";
                    const turnNow = d.turns.find((t) => t.run_id === m.run_id);
                    const view = replied
                      ? adaptivePresentation(
                          turnNow?.state ?? "replied",
                          turnNow?.progress,
                        )
                      : null;
                    // Routine outcomes say how far the work was checked, or
                    // repeat the receipt: they go on the card or in Details.
                    // Anything else (stopped, blocked, needs input) stays.
                    const status = m.products?.length ? cardStatus(view) : null;
                    const folded =
                      replied &&
                      (status !== null || receiptSays(view)) &&
                      (turnNow?.state ?? "replied") === "replied";
                    return (
                      <>
                        {m.products?.map((product, i) => (
                          <WorkCard
                            brief={latestRef.get(product.artifact_id) !== m.id}
                            key={`${product.artifact_id}:${product.observation_id}`}
                            product={product}
                            now={
                              results.data?.[product.artifact_id]?.now ??
                              undefined
                            }
                            readState={
                              results.data?.[product.artifact_id]?.read ??
                              (results.reconnecting ? "unconfirmed" : "current")
                            }
                            link={resultLink(
                              `/conversations/${id}`,
                              product,
                              resultState(results.data, product),
                              wsId,
                            )}
                            status={i === 0 ? status : null}
                          />
                        ))}
                        {replied && !folded ? (
                          <TurnOutcome
                            state={turnNow?.state ?? "replied"}
                            progress={turnNow?.progress}
                          />
                        ) : null}
                        {replied ? (
                          <RecordingReceipts
                            progress={turnNow?.progress}
                            names={names}
                          />
                        ) : null}
                        {replied ? (
                          <div className="msg-meta row wrap">
                            {replyTag(m.origin) ? (
                              <span className="msg-tag">
                                {replyTag(m.origin)}
                              </span>
                            ) : null}
                            <TurnProgressDetails
                              progress={turnNow?.progress}
                              recorded={m.text}
                              outcome={folded ? view : null}
                            />
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              </div>
              {turn && !hasReply(turn.run_id) ? (
                <RecordingReceipts progress={turn.progress} names={names} />
              ) : null}
              {turn && turn.state !== "replied" ? (
                <div
                  className="msg-pending"
                  data-state={turn.state}
                  role={turn.state === "queued" ? "status" : undefined}
                >
                  <TurnSummary
                    state={turn.state}
                    progress={turn.progress}
                    fallback={PENDING[turn.state]}
                    execution={
                      turn.state === "queued" ||
                      turn.state === "responding" ||
                      turn.state === "unavailable"
                        ? turnExecution(turn.run_id, execution.data)
                        : null
                    }
                  />
                  {/* The service's exact reason explains a failure or what to
                      do next; it stays one click away, not in primary copy. */}
                  {turn.reason &&
                  (turn.state === "failed" ||
                    turn.state === "unavailable" ||
                    turn.state === "outcome_unknown") ? (
                    <details className="ids-details">
                      <summary>Why</summary>
                      <p className="ids">{turn.reason}</p>
                    </details>
                  ) : null}
                  {!d.messages.some(
                    (message) =>
                      message.author === "agent" &&
                      message.run_id === turn.run_id,
                  ) ? (
                    <TurnProgressDetails progress={turn.progress} />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <ExecutionLine execution={execution} />
      {res.reconnecting ? (
        <p role="status" data-state="reconnecting">
          Connection lost. Showing what was last read; sending waits until it
          reconnects.{" "}
          {CAPABILITIES.naturalAdmission
            ? "Your draft and files are kept."
            : "Your draft is kept."}
        </p>
      ) : null}
      <div className="row">
        <button
          className="link-quiet small"
          onClick={() => void Promise.all([res.refresh(), results.refresh()])}
        >
          Refresh conversation
        </button>
      </div>

      {controlled ? (
        <details className="ids-details">
          <summary>About these replies</summary>
          <p className="ids">
            Replies marked “Test reply” come from a controlled test transport
            that checks the conversation works end to end. They aren’t a model’s
            answer, and no model was called.
          </p>
        </details>
      ) : null}

      {d.assignment_ids.length ? (
        <section className="stack" aria-labelledby="handed-title">
          <h2 id="handed-title" className="section-title">
            Handed over
          </h2>
          <ul className="work-list">
            {d.assignment_ids.map((aid) => {
              const status = holdStatus(holds[aid]);
              const goal = holdGoal(holds[aid]);
              const from = recordedIn[aid];
              return (
                <li key={aid} className="stack-xs">
                  <Link
                    className="work-row"
                    href={scopedHref(`/assignments/${aid}`, wsId)}
                    data-assignment={aid}
                  >
                    <span className="work-row-main">
                      <span className="work-row-title clamp-2">
                        {goal ? shortTitle(goal) : "A recorded hand-over"}
                      </span>
                      {status?.next ? (
                        <span
                          className="work-row-next clamp-2"
                          data-testid="hold-next"
                        >
                          {status.next}
                        </span>
                      ) : null}
                      <span className="work-row-status">
                        {status ? (
                          <StatusBadge
                            label={status.label}
                            tone={status.tone}
                          />
                        ) : null}
                        <span className="work-row-note">
                          {status?.note ?? "Open it to see where it stands."}
                        </span>
                      </span>
                    </span>
                    <span className="work-row-go" aria-hidden="true">
                      ↗
                    </span>
                  </Link>
                  {from ? (
                    <a className="link-quiet small" href={`#run-${from}`}>
                      Where it was recorded in this conversation
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );

  return (
    <div className="agent-col conversation-page">
      {back}
      <header className="stack">
        <h1 className="h1-long">{d.conversation.title}</h1>
        <div className="row">
          <StatusBadge
            label={open ? (inFlight ? "Waiting for a reply" : "Open") : "Ended"}
            tone={open ? (inFlight ? "status-working" : "") : ""}
          />
          {d.conversation.context_count ? (
            <span className="small muted">
              Uses {d.conversation.context_count} record
              {d.conversation.context_count === 1 ? "" : "s"} you chose
            </span>
          ) : (
            <span className="small muted">No context attached</span>
          )}
        </div>
      </header>

      {wsId ? (
        <WorkAreaHeader
          key={`${wsId}:${id}`}
          ws={wsId}
          id={id}
          area={d.conversation.work_area}
          version={d.conversation.work_version}
          refresh={res.refresh}
        />
      ) : null}

      {history}

      {open && d.conversation.model_activation === "revoked" ? (
        <p className="notice-line" role="status" data-testid="answers-off">
          Answers are turned off for this conversation. What’s here stays as it
          is; new messages can’t be sent, and your draft is kept.
        </p>
      ) : null}
      {open ? (
        <form
          className="ask conversation-ask"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor="follow-up" className="sr-only">
            Continue the conversation
          </label>
          <textarea
            id="follow-up"
            ref={boxRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Reply, steer, or add something…"
            rows={2}
            disabled={sending || uncertainSend}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {CAPABILITIES.naturalAdmission ? (
            <AttachedFiles
              files={reply.files}
              error={reply.fileError}
              locked={reply.filesLocked}
              onAdd={(list) => void reply.addFiles(list)}
              onRemove={reply.removeFile}
            />
          ) : null}
          {sendError instanceof ApiError && sendError.isVersionConflict ? (
            <p className="hint" role="status">
              This conversation changed since you looked. Your message is kept;
              send it again to add it after what’s new.
            </p>
          ) : sendError ? (
            <ErrorNotice
              error={sendError}
              describe={(e) =>
                describeSendError(e, d.conversation.model_activation)
              }
            />
          ) : null}
          <div className="ask-bar">
            <span className="hint">
              {uncertainSend
                ? "Your last send wasn’t confirmed. Sending again replays the same message."
                : inFlight
                  ? "Sending now replaces the reply in progress; your earlier messages stay."
                  : lastStopped(d.turns)
                    ? STOPPED_HINT
                    : "Ask, steer, or add detail."}
            </span>
            <button
              type="button"
              className="btn btn-sm delegate"
              onClick={() => setHandoverOpen((v) => !v)}
              aria-expanded={handoverOpen}
              title="Saves what to carry forward. It stays paused: I can’t work on it on my own yet."
            >
              Record a hand-over
            </button>
            <button
              type="submit"
              className="send-round"
              aria-label="Send"
              title="Send"
              disabled={!reply.canSend}
            >
              <span aria-hidden="true">↑</span>
            </button>
          </div>
        </form>
      ) : (
        <p className="hint">
          This conversation has ended. Its history is kept.
        </p>
      )}

      {open && wsId ? (
        <OperationComposer
          ws={wsId}
          cid={id}
          version={d.conversation.work_version}
          refresh={res.refresh}
          held={
            res.reconnecting || d.conversation.model_activation === "revoked"
          }
        />
      ) : null}

      {open && handoverOpen ? (
        <section
          className="card card-quiet handover"
          aria-labelledby="handover-title"
        >
          <h2 id="handover-title">Record a hand-over</h2>
          <p className="small muted">
            This saves what to carry forward, linked to this conversation. I
            can’t work on it on my own yet: it stays paused, and nothing happens
            until it’s picked up here.
          </p>
          <label className="field">
            <span className="field-label">What to carry forward</span>
            <textarea
              value={goalText}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              disabled={handing || Boolean(handCmd.current)}
            />
          </label>
          <label className="field">
            <span className="field-label">Done when</span>
            <input
              value={doneWhen}
              onChange={(e) => setDoneWhen(e.target.value)}
              placeholder="For example: we’ve reviewed it together"
              disabled={handing || Boolean(handCmd.current)}
            />
          </label>
          {handError ? <ErrorNotice error={handError} /> : null}
          <div className="row">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void handOver()}
              disabled={
                handing ||
                (!handCmd.current && (!goalText.trim() || !doneWhen.trim()))
              }
            >
              {handing
                ? "Recording…"
                : handCmd.current
                  ? "Retry the same hand-over"
                  : "Save paused hand-over"}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setHandoverOpen(false)}
              disabled={handing}
            >
              Not now
            </button>
          </div>
        </section>
      ) : null}

      {open ? (
        <details className="ids-details" open={endPending || undefined}>
          <summary>End this conversation</summary>
          <div className="stack-sm" style={{ marginTop: 8 }}>
            <p className="small muted">
              Ending stops any reply in progress. The history and anything you
              handed over are kept.
            </p>
            {endPending ? (
              <p className="hint" role="status">
                Ending wasn’t confirmed. Ending again replays the same request.
              </p>
            ) : null}
            {confirmEnd || endPending ? (
              <div className="row">
                <button
                  type="button"
                  className="btn btn-sm btn-danger-quiet"
                  onClick={() => void end()}
                  disabled={ending}
                >
                  {ending ? "Ending…" : "End conversation"}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => setConfirmEnd(false)}
                  disabled={ending}
                >
                  Keep it open
                </button>
              </div>
            ) : (
              <div className="row">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setConfirmEnd(true)}
                >
                  End…
                </button>
              </div>
            )}
            {endError ? <ErrorNotice error={endError} /> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
