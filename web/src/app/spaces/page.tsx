"use client";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { useWorkspace } from "@/lib/client/workspace";
import { useResource } from "@/lib/client/hooks";
import type { AssignmentSummary } from "@/lib/contract/types";
import { ErrorNotice, StatusBadge, assignmentStatus } from "@/components/ui";

export default function SpacesPage() {
  const { workspace, error } = useWorkspace();
  const id = workspace?.id;
  const work = useResource<AssignmentSummary[]>(
    id ? `spaces:${id}` : null,
    async (signal) => (await api.listAssignments(id!, signal)).items,
    {
      pollMs: 3000,
      shouldPoll: (items) =>
        Boolean(
          items?.some(
            (item) => item.state === "queued" || item.state === "working",
          ),
        ),
    },
  );
  if (error) return <ErrorNotice error={error} />;
  return (
    <section className="stack-lg stack">
      <header className="stack">
        <div className="eyebrow">Spaces</div>
        <h1>{workspace?.name ?? "Loading your space…"}</h1>
        <p className="muted">
          Your work, its context, and the decisions that carry it forward.
        </p>
      </header>
      <p className="small muted">
        {workspace?.scope_label ?? "Private"} · This installation supports one
        personal workspace. Shared Spaces and invitations are not enabled.
      </p>
      <Link className="btn btn-primary" href="/">
        Start something with your agent
      </Link>
      {work.error ? <ErrorNotice error={work.error} /> : null}
      {work.loading && !work.data ? (
        <p role="status">Loading saved work…</p>
      ) : null}
      {work.data?.length === 0 ? (
        <p className="muted">
          Your first request will create a working area here.
        </p>
      ) : null}
      <div className="space-work-grid">
        {work.data?.map((item) => {
          const status = assignmentStatus(item.state, item.stage);
          return (
            <Link
              className="space-work"
              href={`/assignments/${item.id}`}
              key={item.id}
            >
              <StatusBadge label={status.label} tone={status.tone} />
              <h2>{item.title}</h2>
              <p>
                {item.latest_result ??
                  "Open this responsibility to inspect its progress and working materials."}
              </p>
              {item.next_step ? (
                <p className="small muted">{item.next_step}</p>
              ) : null}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
