"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { useResource } from "@/lib/client/hooks";
import { useWorkOverview } from "@/lib/client/overview";
import { useWorkspace } from "@/lib/client/workspace";
import { ApiError } from "@/lib/contract/errors";
import type { SourceDetail } from "@/lib/contract/types";
import { formatTime } from "@/lib/time";
import { Composer } from "@/components/Composer";
import { ErrorNotice } from "@/components/ui";
import { WorkRow } from "@/components/WorkRow";

export default function SpacePage() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const id = decodeURIComponent(spaceId);
  const { workspaces, loading, zone } = useWorkspace();
  const space = workspaces.find((w) => w.id === id) ?? null;
  const [tab, setTab] = useState<"work" | "context">("work");
  const overview = useWorkOverview(space ? space.id : null);
  const sources = useResource<SourceDetail[]>(
    space && tab === "context" ? `space-sources:${space.id}` : null,
    async (signal) => (await api.listSources(space!.id, signal)).items,
  );

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
    <section className="page-wide stack-lg stack" aria-labelledby="space-title">
      <p className="context-line">
        <span className="dot" aria-hidden="true" />
        <Link href="/spaces">Spaces</Link> / {space?.name ?? "…"}
      </p>
      <header className="stack">
        <p className="eyebrow-caps">
          {space?.kind === "shared" ? "Shared" : "Private · Personal"}
        </p>
        <h1 id="space-title">{space?.name ?? "Loading…"}</h1>
        <p className="lede">
          Your work here, the records it may use, and what’s waiting on you.
        </p>
      </header>
      <Composer
        wsId={space?.id ?? null}
        contextLabel={space?.name ?? "This space"}
      />
      <div className="tabs" role="tablist" aria-label="Space">
        {(["work", "context"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            className="tab"
            onClick={() => setTab(t)}
          >
            {t === "work" ? "Work" : "Context"}
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
          <p role="status">Loading saved work…</p>
        ) : null}
        {overview.data?.length === 0 ? (
          <p className="muted">
            Nothing here yet. Your first request will appear here.
          </p>
        ) : null}
        <ul className="work-list">
          {overview.data?.map((item) => (
            <WorkRow key={item.id} item={item} />
          ))}
        </ul>
      </div>
      <div
        id="panel-context"
        role="tabpanel"
        aria-labelledby="tab-context"
        hidden={tab !== "context"}
      >
        <p className="hint">
          Records you can access in this space now, at their current version.
        </p>
        {sources.error ? <ErrorNotice error={sources.error} /> : null}
        {sources.loading && !sources.data ? (
          <p role="status">Loading records…</p>
        ) : null}
        <ul className="work-list">
          {sources.data?.map((s) => (
            <li key={s.id} className="source-row">
              <span className="work-row-title">{s.title}</span>
              <span className="work-row-status">
                {s.id} @{s.version} · observed {formatTime(s.observed_at, zone)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
