"use client";
import Link from "next/link";
import type { ConversationWork } from "@/lib/client/conversation-work";
import { formatTime } from "@/lib/time";
import { StatusBadge } from "@/components/ui";

const KIND: Record<ConversationWork["kind"], string> = {
  table: "Table",
  tool: "Tool",
  file: "File",
};

/** One product a conversation owns; opens the exact work, not a summary. */
export function ConversationWorkRow({
  w,
  zone,
}: {
  w: ConversationWork;
  zone: string;
}) {
  const status = w.decision
    ? w.decision.fresh
      ? { label: "Decision needed", tone: "status-attention" }
      : { label: "Proposal out of date", tone: "status-working" }
    : { label: KIND[w.kind], tone: "status-ok" };
  const note = w.decision
    ? w.decision.fresh
      ? "A proposed version is waiting for you"
      : "It was made from an earlier saved version"
    : `${w.saved_by === "you" ? "Last saved by you" : "Saved"} · ${formatTime(
        w.updated_at,
        zone,
      )}`;
  return (
    <li>
      <Link
        className="work-row"
        href={`/conversations/${w.conversation_id}/artifacts/${w.artifact_id}`}
        data-artifact={w.artifact_id}
        data-decision={
          w.decision ? (w.decision.fresh ? "pending" : "stale") : "none"
        }
      >
        <span className="work-row-main">
          <span className="work-row-title clamp-2">{w.title}</span>
          <span className="work-row-note clamp-2">
            From “{w.conversation_title}”
          </span>
          <span className="work-row-status">
            <StatusBadge label={status.label} tone={status.tone} />
            <span className="work-row-note">{note}</span>
          </span>
        </span>
        <span className="work-row-go" aria-hidden="true">
          ↗
        </span>
      </Link>
    </li>
  );
}
