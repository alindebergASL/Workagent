"use client";
import Link from "next/link";
import { useWorkspace } from "@/lib/client/workspace";
import { ErrorNotice } from "@/components/ui";

export default function SpacesPage() {
  const { workspaces, loading, error } = useWorkspace();
  if (error) return <ErrorNotice error={error} />;
  return (
    <section
      className="page-wide stack-lg stack"
      aria-labelledby="spaces-title"
    >
      <p className="context-line">
        <span className="dot" aria-hidden="true" />
        Spaces
      </p>
      <header className="page-head">
        <div className="stack">
          <h1 id="spaces-title">Spaces</h1>
          <p className="lede">
            A place for the work, and the records it needs.
          </p>
        </div>
      </header>
      {loading ? <p role="status">Loading your spaces…</p> : null}
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
        This build has one private space. Shared spaces and invitations are not
        available yet.
      </p>
    </section>
  );
}
