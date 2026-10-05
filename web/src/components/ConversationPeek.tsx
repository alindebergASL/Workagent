"use client";
import Link from "next/link";
import type { ConversationDetailView } from "@/lib/contract/types";

const TURN_TEXT: Partial<Record<string, string>> = {
  queued: "Waiting for a reply.",
  responding: "Replying…",
  cancelled: "Stopped before a reply.",
  failed: "This didn’t complete.",
  unavailable: "Nothing has picked this up yet.",
  no_reply: "No reply was recorded.",
};

/**
 * The conversation this work came from, shown beside it: the latest
 * messages and the current turn's state, from the conversation record only.
 * Replying happens in the conversation itself so its commands keep their
 * exact identity and recovery.
 */
export function ConversationPeek({
  conversation: d,
  artifactId,
}: {
  conversation: ConversationDetailView;
  artifactId: string;
}) {
  const recent = d.messages.slice(-8);
  const last = d.turns.at(-1);
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
      {last && last.state !== "replied" && TURN_TEXT[last.state] ? (
        <p className="msg-pending" data-state={last.state}>
          {TURN_TEXT[last.state]}
        </p>
      ) : null}
      <Link className="btn btn-sm" href={`/conversations/${d.conversation.id}`}>
        Continue in the conversation
      </Link>
    </div>
  );
}
