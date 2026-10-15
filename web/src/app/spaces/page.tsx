"use client";
import Link from "next/link";
import { useWorkspace } from "@/lib/client/workspace";
import { WorkAreaList } from "@/components/WorkAreas";
import { ErrorNotice } from "@/components/ui";

export default function SpacesPage() {
  const { workspaces, loading, error } = useWorkspace();
  if (error) return <ErrorNotice error={error} />;
  return (
    <section className="agent-col" aria-labelledby="spaces-title">
      <p className="context-line">
        <span className="dot" aria-hidden="true" />
        Spaces
      </p>
      <header className="page-head">
        <div className="stack">
          <h1 id="spaces-title">Spaces</h1>
          <p className="lede">
            Projects keep related work and its conversation together, so you can
            pick up where you left off. You don’t need one to begin.
          </p>
        </div>
      </header>
      {loading ? <p role="status">Loading your spaces…</p> : null}
      {workspaces.map((w) => (
        <WorkAreaList key={w.id} ws={w.id} />
      ))}
      <h2>Workspaces</h2>
      <div className="space-grid">
        {workspaces.map((w) => (
          <Link
            key={w.id}
            className="space-card"
            href={`/spaces/${encodeURIComponent(w.id)}`}
          >
            <span
              className="space-banner"
              data-kind={w.kind}
              aria-hidden="true"
            />
            <span className="space-card-body">
              <span className="space-card-title">{w.name}</span>
              <span className="small muted">
                {w.kind === "personal" ? "Private · Your own work" : "Shared"}
              </span>
            </span>
          </Link>
        ))}
      </div>
      <p className="hint">
        Every project belongs to one of your workspaces and is only visible to
        you. Shared workspaces and invitations aren’t available yet.
      </p>
    </section>
  );
}
