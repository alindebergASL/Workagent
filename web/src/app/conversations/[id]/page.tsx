"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { newCommandId } from "@/lib/client/api";
import { useResource } from "@/lib/client/hooks";
import { useConversationReply } from "@/lib/client/conversation-reply";
import { usePendingCommand } from "@/lib/client/pending-command";
import { conversationApi } from "@/lib/client/real-api";
import { useWorkspace } from "@/lib/client/workspace";
import { ApiError } from "@/lib/contract/errors";
import type {
  ChatMessage,
  ConversationDetailView,
  TurnState,
} from "@/lib/contract/types";
import { OperationComposer } from "@/components/OperationComposer";
import { RichText } from "@/components/RichText";
import { ErrorNotice, StatusBadge } from "@/components/ui";
import {
  TurnProgressDetails,
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
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const { workspace } = useWorkspace();
  const wsId = workspace?.id ?? null;
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

  // ---- follow-up composer ----
  const reply = useConversationReply({
    wsId,
    cid: id,
    version: d?.conversation.work_version ?? null,
    refresh: res.refresh,
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
    <Link className="back-link" href="/">
      ← Back to agent
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

      <ol className="thread" aria-label="Conversation">
        {d.messages.map((m) => {
          const turn = m.author === "person" ? turnOf(m) : null;
          return (
            <li key={m.id} className="thread-turn">
              <div className={`msg msg-${m.author}`}>
                {m.author === "agent" ? (
                  <div
                    className="agent-presence agent-presence-xs"
                    aria-hidden="true"
                  />
                ) : null}
                <div className="stack-sm">
                  {m.author === "agent" ? (
                    <div className="msg-body">
                      <span className="sr-only">Agent: </span>
                      <RichText text={m.text} />
                    </div>
                  ) : (
                    <p>
                      <span className="sr-only">You: </span>
                      {m.text}
                    </p>
                  )}
                  {m.products?.map((product) => (
                    <Link
                      key={`${product.artifact_id}:${product.observation_id}`}
                      className="product-link"
                      data-kind={product.kind}
                      href={`/conversations/${id}/artifacts/${product.artifact_id}`}
                    >
                      <span>
                        Open {product.kind}
                        {product.proposal_id ? " proposed change" : " product"}
                      </span>
                      <span aria-hidden="true">↗</span>
                    </Link>
                  ))}
                  {m.author === "agent" && replyTag(m.origin) ? (
                    <span className="msg-tag">{replyTag(m.origin)}</span>
                  ) : null}
                  {m.author === "agent" ? (
                    <TurnProgressDetails
                      progress={
                        d.turns.find((t) => t.run_id === m.run_id)?.progress
                      }
                    />
                  ) : null}
                </div>
              </div>
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

      {res.reconnecting ? (
        <p role="status">
          Connection lost. Displaying previously read state; refresh to confirm.
        </p>
      ) : null}
      <div className="row">
        <button className="link-quiet small" onClick={() => void res.refresh()}>
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
            {d.assignment_ids.map((aid) => (
              <li key={aid}>
                <Link className="work-row" href={`/assignments/${aid}`}>
                  <span className="work-row-main">
                    <span className="work-row-title">Recorded hand-over</span>
                    <span className="work-row-note">
                      Paused: I can’t carry work forward on my own yet.
                    </span>
                  </span>
                  <span className="work-row-go" aria-hidden="true">
                    ↗
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
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
          {sendError instanceof ApiError && sendError.isVersionConflict ? (
            <p className="hint" role="status">
              This conversation changed since you looked. Your message is kept;
              send it again to add it after what’s new.
            </p>
          ) : sendError ? (
            <ErrorNotice error={sendError} />
          ) : null}
          <div className="ask-bar">
            <span className="hint">
              {uncertainSend
                ? "Your last send wasn’t confirmed. Sending again replays the same message."
                : inFlight
                  ? "Sending now replaces the reply in progress; your earlier messages stay."
                  : "Ask, steer, or add detail."}
            </span>
            <button
              type="button"
              className="btn btn-sm delegate"
              onClick={() => setHandoverOpen((v) => !v)}
              aria-expanded={handoverOpen}
            >
              Take it from here
            </button>
            <button
              type="submit"
              className="send-round"
              aria-label="Send"
              title="Send"
              disabled={(!text.trim() && !uncertainSend) || sending}
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
        />
      ) : null}

      {open && handoverOpen ? (
        <section
          className="card card-quiet handover"
          aria-labelledby="handover-title"
        >
          <h2 id="handover-title">Hand this over</h2>
          <p className="small muted">
            I’ll record it as work you’ve handed to me, linked to this
            conversation. I can’t carry work forward on my own yet, so it stays
            paused until I can.
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
                  : "Record hand-over"}
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
