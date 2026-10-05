"use client";
import Link from "next/link";
import type { ConversationSummary } from "@/lib/contract/types";
import { formatTime } from "@/lib/time";

/** One conversation: its title, whether it's open, and when it started. */
export function ConversationRow({
  c,
  zone,
}: {
  c: ConversationSummary;
  zone: string;
}) {
  return (
    <li>
      <Link
        className="work-row"
        href={`/conversations/${c.id}`}
        data-conversation={c.id}
      >
        <span className="work-row-main">
          <span className="work-row-title clamp-2">{c.title}</span>
          <span className="work-row-note">
            {c.state === "open" ? "Open" : "Ended"}
            {c.created_at ? ` · started ${formatTime(c.created_at, zone)}` : ""}
          </span>
        </span>
        <span className="work-row-go" aria-hidden="true">
          ↗
        </span>
      </Link>
    </li>
  );
}
