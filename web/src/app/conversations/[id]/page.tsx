"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { API_BASE, API_MODE, newCommandId } from "@/lib/client/api";
import { useResource } from "@/lib/client/hooks";
import {
  carryDraftHome,
  useConversationReply,
} from "@/lib/client/conversation-reply";
import { usePendingCommand } from "@/lib/client/pending-command";
import { conversationApi } from "@/lib/client/real-api";
import type { WorkspaceScope } from "@/lib/client/workspace";
import { scopedHref, WORKSPACE_PARAM } from "@/lib/scope";
import { backTo, ScopedRecord } from "@/components/ScopedRecord";
import { useExecution } from "@/lib/client/execution";
import { turnExecution } from "@/lib/execution-view";
import { ExecutionLine } from "@/components/ExecutionLine";
import { resultState, useResultStates } from "@/lib/client/result-states";
import { resultLink } from "@/lib/result-links";
import { holdGoal, useHolds } from "@/lib/client/responsibility";
import { holdStatus, idleHold } from "@/lib/hold-view";
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
import { landAtLatest } from "@/lib/client/landing";
import {
  AttachedFiles,
  FileContext,
  SentFiles,
} from "@/components/AttachedFiles";
import { contextForMessage } from "@/lib/attachment-context";
import { CAPABILITIES } from "@/lib/client/capabilities";
import { ErrorNotice, StatusBadge } from "@/components/ui";
import { WorkCard } from "@/components/WorkCard";
import { WorkspaceFiles } from "@/components/WorkspaceFiles";
import { ToolActivity } from "@/components/ToolActivity";
import { CurrentWork } from "@/components/CurrentWork";
import { useWorkState } from "@/lib/client/work-state";
import {
  ContinueRun,
  ConversationDocuments,
  DocumentPicker,
  MessageDocuments,
  QueuedMessages,
  StopRun,
} from "@/components/Batch2Controls";
import { documentApi, queueApi, runApi } from "@/lib/client/batch2-api";
import {
  checkpointsCurrent,
  continueLatestRun,
  stopOffered,
} from "@/lib/batch2-view";
import {
  adaptivePresentation,
  cardStatus,
  receiptSays,
  lastStopped,
  lastUnresolved,
  STOPPED_HINT,
  UNRESOLVED_HINT,
} from "@/lib/adaptive-presentation";
import {
  AgentReply,
  RuntimeRequest,
  TurnOutcome,
  TurnProgressDetails,
  RecordingReceipts,
  TurnSummary,
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
  // Current work: one subscription for this conversation while it is shown.
  // An event only invalidates; the canonical reads below are re-done.
  // B2.4/B2.5 server state: the durable queue, run checkpoints and retained
  // documents. Read only from the server; re-read when work events arrive.
  const real = API_MODE === "real" && Boolean(wsId);
  const queued = useResource(real ? `queued:${wsId}:${id}` : null, (signal) =>
    queueApi.list(wsId!, id, signal).then((r) => r.items),
  );
  // Read for the exact conversation version shown: a new version resets it,
  // so a fresh Continue never relies on checkpoints read before that version.
  const checkpoints = useResource(
    real
      ? `checkpoints:${wsId}:${id}:${d?.conversation.work_version ?? "-"}`
      : null,
    (signal) => runApi.checkpoints(wsId!, id, signal).then((r) => r.items),
  );
  const documents = useResource(
    real ? `documents:${wsId}:${id}` : null,
    (signal) => documentApi.list(wsId!, id, signal).then((r) => r.items),
  );
  const refreshAll = () =>
    void Promise.all([
      res.refresh(),
      results.refresh(),
      queued.refresh(),
      checkpoints.refresh(),
      documents.refresh(),
    ]);
  const work = useWorkState(API_BASE, wsId, id, {
    enabled: API_MODE === "real",
    onInvalidate: refreshAll,
  });
  const revoked = work.revoked;
  // "Access changed" is only true of a conversation this page has shown; one
  // that was never readable here is simply not available.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (d) setShown(true);
  }, [d]);
  const { refresh: refreshConversation } = res;
  useEffect(() => {
    // Lost access: re-read so the cached conversation is dropped too.
    if (revoked) void refreshConversation();
  }, [revoked, refreshConversation]);
  const execution = useExecution(wsId);
  const { holds } = useHolds(wsId, d?.assignment_ids ?? []);

  // ---- follow-up composer ----
  const reply = useConversationReply({
    wsId,
    cid: id,
    version: d?.conversation.work_version ?? null,
    refresh: res.refresh,
    attach: CAPABILITIES.naturalAdmission,
    documents: real,
    onQueued: () => void queued.refresh(),
    // Sending waits for a confirmed current read: not while reconnecting,
    // before the first read, or once the conversation has ended. Drafting
    // and attaching go on; nothing is sent when it reconnects.
    held:
      revoked ||
      res.reconnecting ||
      !res.data ||
      res.data.conversation.state !== "open" ||
      res.data.conversation.model_activation === "revoked" ||
      lastUnresolved(res.data.turns),
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

  // Arriving from "Steer" on Home puts the cursor in the reply box once it
  // exists, with any draft kept.
  const steerFocused = useRef(false);
  useEffect(() => {
    if (steerFocused.current || location.hash !== "#follow-up") return;
    const el = boxRef.current;
    if (!el) return;
    steerFocused.current = true;
    el.focus();
    el.scrollIntoView({ block: "center" });
  });

  // On a phone the conversation opens at its latest exchange, once, unless
  // the person came here for a particular place in it.
  const landed = useRef(false);
  const hasData = Boolean(d);
  useEffect(() => {
    if (landed.current || !hasData) return;
    landed.current = true;
    const requests = document.querySelectorAll<HTMLElement>(
      ".thread > .thread-turn[id^='run-']",
    );
    return landAtLatest(requests[requests.length - 1] ?? null, {
      purposeful:
        location.hash !== "" ||
        search.get("stop") === "1" ||
        search.get("handover") === "1",
    });
  }, [hasData, search]);

  // ---- explicit hand-over ----
  const [handoverOpen, setHandoverOpen] = useState(
    search.get("handover") === "1",
  );
  // On a phone the form opens below the reply box docked at the bottom.
  const handRef = useRef<HTMLElement>(null);
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
  // Arriving with ?stop=1 (from beside the work) opens the stop confirmation.
  const [confirmEnd, setConfirmEnd] = useState(search.get("stop") === "1");
  const [ending, setEnding] = useState(false);
  const [carried, setCarried] = useState(false);
  const endRef = useRef<HTMLDetailsElement>(null);
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
      // An unsent message goes to Home rather than staying in a closed box.
      if (carryDraftHome(wsId, text)) {
        setText("");
        setCarried(true);
      }
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
  // Without access nothing read earlier is shown, but an unsent draft is
  // kept where the person can still copy it.
  const keptDraft = text.trim() ? (
    <label className="field" data-testid="kept-draft">
      <span className="field-label">Your unsent message (kept, not sent)</span>
      <textarea readOnly value={text} rows={3} />
    </label>
  ) : null;
  if (revoked && !shown)
    return (
      <div className="agent-col">
        {back}
        <ErrorNotice
          error={
            res.error ??
            new ApiError({
              code: "not_found_or_not_authorized",
              status: 404,
              message: "",
            })
          }
        />
        {keptDraft}
      </div>
    );
  if (revoked)
    return (
      <div className="agent-col">
        {back}
        {wsId ? <CurrentWork work={work} ws={wsId} cid={id} /> : null}
        {keptDraft}
      </div>
    );
  if (res.error && !d)
    return (
      <div className="agent-col">
        {back}
        <ErrorNotice error={res.error} />
        {keptDraft}
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
  // The latest run, only from a current canonical snapshot of exactly this
  // version (a successor run counts). Continue only applies to it.
  const latestRunId = continueLatestRun({
    snapshot: work.snapshot,
    snapshotStale: work.stale,
    checkpointsCurrent: checkpointsCurrent(checkpoints),
    conversationId: id,
    conversationVersion: d.conversation.work_version,
  });
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
                  {m.author !== "agent" ? (
                    <FileContext items={contextForMessage(d, m.id)} />
                  ) : null}
                  {m.author === "person" && m.documents?.length ? (
                    <MessageDocuments
                      docs={m.documents}
                      href={(docId) => `#document-${docId}`}
                    />
                  ) : null}
                  {(() => {
                    const replied = m.author === "agent";
                    const turnNow = d.turns.find((t) => t.run_id === m.run_id);
                    const view = replied
                      ? adaptivePresentation(
                          turnNow?.state ?? "replied",
                          turnNow?.progress,
                          Boolean(m.products?.length),
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
                            savedWork={Boolean(m.products?.length)}
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
                            <TurnProgressDetails
                              origin={m.origin}
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
                  {wsId &&
                  real &&
                  open &&
                  stopOffered({
                    turnState: turn.state,
                    runId: turn.run_id,
                    snapshot: work.snapshot,
                    snapshotStale: work.stale,
                    conversationId: id,
                    conversationVersion: d.conversation.work_version,
                  }) ? (
                    <StopRun
                      ws={wsId}
                      cid={id}
                      runId={turn.run_id}
                      version={d.conversation.work_version}
                      refresh={refreshAll}
                    />
                  ) : null}
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

      <ExecutionLine execution={execution} perTurn />
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
                        {/* Held and idle: the heading already says it's
                            handed over; the row doesn't repeat that
                            nothing runs for it. */}
                        {idleHold(holds[aid]) ? null : (
                          <span className="work-row-note">
                            {status?.note ?? "Open it to see where it stands."}
                          </span>
                        )}
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
        {/* Only what's worth knowing: an open, idle conversation needs no
            badge, and having no chosen records needs no line. */}
        {!open || inFlight || d.conversation.context_count ? (
          <div className="row">
            {!open || inFlight ? (
              <StatusBadge
                label={open ? "Waiting for a reply" : "Ended"}
                tone={open ? "status-working" : ""}
              />
            ) : null}
            {d.conversation.context_count ? (
              <span className="small muted">
                Uses {d.conversation.context_count} record
                {d.conversation.context_count === 1 ? "" : "s"} you chose
              </span>
            ) : null}
          </div>
        ) : null}
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

      {wsId ? <CurrentWork work={work} ws={wsId} cid={id} /> : null}

      {wsId && real && open && !inFlight ? (
        <ContinueRun
          ws={wsId}
          cid={id}
          version={d.conversation.work_version}
          checkpoints={checkpoints.data}
          latestRunId={latestRunId}
          stopReason={
            d.turns.find((t) => t.run_id === latestRunId)?.stop_reason ?? null
          }
          refresh={refreshAll}
        />
      ) : null}
      {wsId && real ? (
        <QueuedMessages
          ws={wsId}
          cid={id}
          items={queued.data}
          refresh={() => void queued.refresh()}
        />
      ) : null}
      {wsId && real ? (
        <ConversationDocuments ws={wsId} cid={id} items={documents.data} />
      ) : null}
      {wsId && real ? (
        <WorkspaceFiles
          ws={wsId}
          cid={id}
          workVersion={d.conversation.work_version}
        />
      ) : null}
      {wsId && real && d.turns.length > 0 ? (
        <ToolActivity ws={wsId} runId={d.turns[d.turns.length - 1]!.run_id} />
      ) : null}

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
            disabled={
              sending || uncertainSend || reply.queueing || reply.queueUncertain
            }
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
          {real ? (
            <DocumentPicker
              docs={reply.docs}
              error={reply.docError}
              locked={reply.docsLocked}
              onAdd={(list) => void reply.addDocuments(list)}
              onRemove={reply.removeDocument}
              problems={reply.docProblems}
              onReattach={reply.reattachDocument}
              recovery={reply.docRecovery}
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
            <span
              className="hint"
              // Only the plain prompt: a phone's docked box leaves it out.
              data-routine={
                uncertainSend ||
                lastUnresolved(d.turns) ||
                inFlight ||
                lastStopped(d.turns)
                  ? undefined
                  : ""
              }
            >
              {reply.queueUncertain
                ? "Queueing wasn’t confirmed. Queue again replays the same message."
                : uncertainSend
                  ? "Your last send wasn’t confirmed. Sending again replays the same message."
                  : lastUnresolved(d.turns)
                    ? UNRESOLVED_HINT
                    : inFlight
                      ? "Sending now replaces the reply in progress; your earlier messages stay."
                      : lastStopped(d.turns)
                        ? STOPPED_HINT
                        : "Ask, steer, or add detail."}
              {!uncertainSend && lastUnresolved(d.turns) ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="link-quiet small"
                    data-testid="unresolved-check"
                    onClick={() => void res.refresh()}
                  >
                    Check again
                  </button>{" "}
                  ·{" "}
                  <button
                    type="button"
                    className="link-quiet small"
                    data-testid="unresolved-stop"
                    onClick={() => {
                      setConfirmEnd(true);
                      requestAnimationFrame(() =>
                        endRef.current?.scrollIntoView({ block: "center" }),
                      );
                    }}
                  >
                    Stop this conversation…
                  </button>
                </>
              ) : null}
            </span>
            <button
              type="button"
              className="btn btn-sm delegate"
              onClick={() => {
                setHandoverOpen((v) => !v);
                requestAnimationFrame(() =>
                  handRef.current?.scrollIntoView({ block: "nearest" }),
                );
              }}
              aria-expanded={handoverOpen}
              title="Records it as a paused hand-over; nothing runs for this record. To have Workagent work on something, ask it in a conversation."
            >
              Record a hand-over
            </button>
            {real ? (
              <button
                type="button"
                className="btn btn-sm"
                data-testid="queue-later"
                onClick={() => void reply.queue()}
                disabled={!reply.canQueue}
                title="Keeps this message and runs it after the current work settles. Doesn’t interrupt anything."
              >
                {reply.queueing
                  ? "Queueing…"
                  : reply.queueUncertain
                    ? "Queue again"
                    : "Queue for later"}
              </button>
            ) : null}
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
        <p className="hint" role="status">
          This conversation has ended. Its history is kept.
          {carried ? (
            <>
              {" "}
              Your unsent message is waiting on{" "}
              {/* Home starts new work in this workspace, where the draft waits. */}
              <Link
                href={`/?${WORKSPACE_PARAM}=${encodeURIComponent(wsId ?? "")}`}
              >
                Home
              </Link>
              .
            </>
          ) : null}
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
          ref={handRef}
          className="card card-quiet handover"
          aria-labelledby="handover-title"
        >
          <h2 id="handover-title">Record a hand-over</h2>
          <p className="small muted">
            This records what to carry forward as a paused hand-over, linked to
            this conversation. Nothing runs for this record by itself. To have
            Workagent work on something, ask it here in the conversation.
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
        <details
          ref={endRef}
          className="ids-details"
          open={endPending || confirmEnd || undefined}
        >
          <summary>End this conversation</summary>
          <div className="stack-sm" style={{ marginTop: 8 }}>
            <p className="small muted">
              Ending closes this conversation, so nothing new is added to it.
              Its history and anything you handed over are kept, and an unsent
              message moves to Home. A request already sent may still be
              processed by the model service; ending doesn’t undo it.
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
