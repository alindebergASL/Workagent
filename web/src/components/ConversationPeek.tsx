"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useConversationReply } from "@/lib/client/conversation-reply";
import { useResource } from "@/lib/client/hooks";
import { conversationApi } from "@/lib/client/real-api";
import { ApiError } from "@/lib/contract/errors";
import type { ConversationDetailView } from "@/lib/contract/types";
import type { ExactTarget } from "@/lib/contract/natural";
import { ErrorNotice } from "@/components/ui";

const TURN_TEXT: Partial<Record<string, string>> = {
  queued: "Waiting for a reply.",
  responding: "Replying…",
  cancelled: "Stopped before a reply.",
  failed: "This didn’t complete.",
  unavailable: "Nothing has picked this up yet.",
  outcome_unknown:
    "Couldn’t confirm whether this finished. Check the work before asking again.",
  no_reply: "No reply was recorded.",
};

// An admitted turn whose consumer has not claimed it can still progress.
// Keep read-only polling; never resend or infer a successful result.
const awaitingReply = (t: ConversationDetailView["turns"][number]) =>
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
  artifactId,
  wsId,
  refreshWork,
  target,
  unsavedEdits = false,
}: {
  conversation: ConversationDetailView;
  artifactId: string;
  wsId: string;
  refreshWork: () => Promise<unknown>;
  /** The exact saved version a reply is about; undefined on older backends. */
  target?: ExactTarget;
  /** Edits in the working copy that a reply does not include. */
  unsavedEdits?: boolean;
}) {
  const cid = initial.conversation.id;
  const res = useResource<ConversationDetailView>(
    `peek:${wsId}:${cid}`,
    (signal) => conversationApi.get(wsId, cid, signal),
    { pollMs: 2000, shouldPoll: (d) => inFlight(d) },
  );
  const d = res.data ?? initial;
  const reply = useConversationReply({
    wsId,
    cid,
    version: d.conversation.work_version,
    refresh: res.refresh,
    target,
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

  const recent = d.messages.slice(-8);
  const last = d.turns.at(-1);
  const open = d.conversation.state === "open";
  return (
    <div className="agent-pane conversation stack">
      <p className="eyebrow-caps">From the conversation</p>
      <p className="small muted clamp-2">{d.conversation.title}</p>
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
              <p>
                <span className="sr-only">
                  {m.author === "person" ? "You: " : "Agent: "}
                </span>
                {m.text}
              </p>
              {m.products?.some((p) => p.artifact_id === artifactId) ? (
                <span className="msg-tag">This work</span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {res.reconnecting || (res.error && !res.data) ? (
        <p className="msg-pending" role="status" data-state="reconnecting">
          Can’t reach the conversation right now. Showing what was last read.
        </p>
      ) : null}
      {last && last.state !== "replied" && TURN_TEXT[last.state] ? (
        <p className="msg-pending" data-state={last.state}>
          {TURN_TEXT[last.state]}
        </p>
      ) : null}
      {open ? (
        <form
          className="ask peek-ask"
          onSubmit={(e) => {
            e.preventDefault();
            void reply.send();
          }}
        >
          <label htmlFor="peek-reply" className="sr-only">
            Reply about this work
          </label>
          <textarea
            id="peek-reply"
            value={reply.text}
            onChange={(e) => reply.setText(e.target.value)}
            placeholder="Reply about this work…"
            rows={2}
            disabled={reply.sending || reply.uncertain}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void reply.send();
              }
            }}
          />
          {reply.error instanceof ApiError && reply.error.isVersionConflict ? (
            <p className="hint" role="status">
              This conversation changed since you looked. Your message is kept;
              send it again to add it after what’s new.
            </p>
          ) : reply.error ? (
            <ErrorNotice error={reply.error} />
          ) : null}
          <div className="ask-bar">
            <span className="hint">
              {reply.uncertain
                ? "Your last send wasn’t confirmed. Sending again replays the same message."
                : target && unsavedEdits
                  ? "Your unsaved edits aren’t included. Replies work from your saved version."
                  : "Ask about this work or ask for a change."}
            </span>
            <button
              type="submit"
              className="send-round"
              aria-label="Send"
              title="Send"
              disabled={
                (!reply.text.trim() && !reply.uncertain) || reply.sending
              }
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
      <Link className="link-quiet small" href={`/conversations/${cid}`}>
        Open the full conversation
      </Link>
    </div>
  );
}
