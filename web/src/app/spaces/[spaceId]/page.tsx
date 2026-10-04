"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { CAPABILITIES } from "@/lib/client/capabilities";
import { useResource } from "@/lib/client/hooks";
import { useWorkOverview } from "@/lib/client/overview";
import { conversationApi } from "@/lib/client/real-api";
import { useWorkspace } from "@/lib/client/workspace";
import { ApiError } from "@/lib/contract/errors";
import type { ConversationSummary, SourceDetail } from "@/lib/contract/types";
import { formatTime } from "@/lib/time";
import { Composer } from "@/components/Composer";
import { ConversationRow } from "@/components/ConversationRow";
import { ErrorNotice } from "@/components/ui";
import { WorkRow } from "@/components/WorkRow";

type Tab = "work" | "conversations" | "context";

export default function SpacePage() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const id = decodeURIComponent(spaceId);
  const { workspaces, loading, zone } = useWorkspace();
  const space = workspaces.find((w) => w.id === id) ?? null;
  const [tab, setTab] = useState<Tab>("work");
  const overview = useWorkOverview(space ? space.id : null);
  const conversations = useResource<ConversationSummary[]>(
    space && CAPABILITIES.conversation && tab === "conversations"
      ? `space-conversations:${space.id}`
      : null,
    (signal) => conversationApi.list(space!.id, signal),
  );
  const sources = useResource<SourceDetail[]>(
    space && tab === "context" ? `space-sources:${space.id}` : null,
    async (signal) => (await api.listSources(space!.id, signal)).items,
  );
  const tabs: { key: Tab; label: string }[] = [
    { key: "work", label: "Work" },
    ...(CAPABILITIES.conversation
      ? [{ key: "conversations" as const, label: "Conversations" }]
      : []),
    { key: "context", label: "Context" },
  ];

  if (!loading && !space) {
    return (
      <ErrorNotice
        error={
          new ApiError({
            code: "not_found_or_not_authorized",
            status: 404,
            message: "",
          })
        }
        actions={
          <Link className="btn btn-sm" href="/spaces">
            All spaces
          </Link>
        }
      />
    );
  }

  return (
    <div className="agent-col" aria-labelledby="space-title">
      <p className="context-line">
        <span className="dot" aria-hidden="true" />
        <Link href="/spaces">Spaces</Link> / {space?.name ?? "…"}
      </p>
      <header className="stack">
        <p className="eyebrow-caps">
          {space?.kind === "shared" ? "Shared space" : "Private · Your space"}
        </p>
        <h1 id="space-title">{space?.name ?? "Loading…"}</h1>
        <p className="lede">
          Talk things through, hand work over, and keep the records it may use
          in one place.
        </p>
      </header>
      <Composer
        wsId={space?.id ?? null}
        contextLabel={space?.name ?? "This space"}
      />
      <div className="tabs" role="tablist" aria-label="Space">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            className="tab"
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        id="panel-work"
        role="tabpanel"
        aria-labelledby="tab-work"
        hidden={tab !== "work"}
      >
        {overview.error && !overview.data ? (
          <ErrorNotice error={overview.error} />
        ) : null}
        {overview.loading && !overview.data ? (
          <p role="status">Loading work…</p>
        ) : null}
        {overview.data?.length === 0 ? (
          <p className="muted">
            Nothing handed over yet. What you hand over appears here.
          </p>
        ) : null}
        <ul className="work-list">
          {overview.data?.map((item) => (
            <WorkRow key={item.id} item={item} />
          ))}
        </ul>
      </div>

      {CAPABILITIES.conversation ? (
        <div
          id="panel-conversations"
          role="tabpanel"
          aria-labelledby="tab-conversations"
          hidden={tab !== "conversations"}
        >
          {conversations.error && !conversations.data ? (
            <ErrorNotice error={conversations.error} />
          ) : null}
          {conversations.loading && !conversations.data ? (
            <p role="status">Loading conversations…</p>
          ) : null}
          {conversations.data?.length === 0 ? (
            <p className="muted">No conversations here yet.</p>
          ) : null}
          <ul className="work-list">
            {[...(conversations.data ?? [])]
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((c) => (
                <ConversationRow key={c.id} c={c} zone={zone} />
              ))}
          </ul>
        </div>
      ) : null}

      <div
        id="panel-context"
        role="tabpanel"
        aria-labelledby="tab-context"
        hidden={tab !== "context"}
      >
        <p className="hint">
          Records you can use in this space now. Work uses the version shown.
        </p>
        {sources.error ? <ErrorNotice error={sources.error} /> : null}
        {sources.loading && !sources.data ? (
          <p role="status">Loading records…</p>
        ) : null}
        <ul className="work-list">
          {sources.data?.map((s) => (
            <li key={s.id} className="source-row">
              <span className="work-row-title">{s.title}</span>
              <span className="work-row-note">
                Version {s.version} · checked {formatTime(s.observed_at, zone)}
              </span>
              <details className="ids-details">
                <summary>Details</summary>
                <p className="ids">Record {s.id}</p>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
