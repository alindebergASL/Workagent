"use client";
import Link from "next/link";
import { CAPABILITIES } from "@/lib/client/capabilities";
import { useResource } from "@/lib/client/hooks";
import { conversationApi } from "@/lib/client/real-api";
import { useWorkspace } from "@/lib/client/workspace";
import type { ConversationSummary } from "@/lib/contract/types";
import { formatTime } from "@/lib/time";
import { ErrorNotice } from "@/components/ui";

export default function ConversationsPage() {
  const { workspace, zone } = useWorkspace();
  const wsId = workspace?.id ?? null;
  const res = useResource<ConversationSummary[]>(
    wsId && CAPABILITIES.conversation ? `conversations:${wsId}` : null,
    (signal) => conversationApi.list(wsId!, signal),
  );
  const items = [...(res.data ?? [])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  return (
    <div className="agent-col">
      <header className="stack">
        <h1>Conversations</h1>
        <p className="lede">
          {CAPABILITIES.conversation
            ? "Everything you’ve talked through. Start a new one from Agent."
            : "Conversation isn’t connected in this build."}
        </p>
      </header>
      {res.error && !res.data ? <ErrorNotice error={res.error} /> : null}
      {res.data && !items.length ? (
        <p className="muted">No conversations yet.</p>
      ) : null}
      {items.length ? (
        <ul className="work-list">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                className="work-row"
                href={`/conversations/${c.id}`}
                data-conversation={c.id}
              >
                <span className="work-row-main">
                  <span className="work-row-title clamp-2">{c.title}</span>
                  <span className="work-row-note">
                    {c.state === "open" ? "Open" : "Ended"}
                    {c.created_at
                      ? ` · started ${formatTime(c.created_at, zone)}`
                      : ""}
                  </span>
                </span>
                <span className="work-row-go" aria-hidden="true">
                  ↗
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
