"use client";
import { useEffect, useState } from "react";
import type { SourceDetail } from "@/lib/contract/types";
import { api } from "@/lib/client/api";
import { ApiError } from "@/lib/contract/errors";
import { useWorkspace } from "@/lib/client/workspace";
import { formatTime } from "@/lib/time";
import { Drawer, ErrorNotice } from "./ui";

export function SourcesDrawer({
  open,
  onClose,
  assignmentId,
  highlightId,
  artifactTitles,
  returnFocusTo,
}: {
  open: boolean;
  onClose: () => void;
  assignmentId: string;
  highlightId?: string | null;
  artifactTitles: Record<string, string>;
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}) {
  const { workspace, zone } = useWorkspace();
  const [items, setItems] = useState<SourceDetail[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open || !workspace) return;
    const c = new AbortController();
    setItems(null);
    setError(null);
    api
      .getAssignmentSources(workspace.id, assignmentId, c.signal)
      .then((r) => setItems(r.items))
      .catch((e: unknown) => {
        if (!c.signal.aborted) {
          setItems(null);
          setError(
            e instanceof ApiError
              ? e
              : new ApiError({ code: "transport", status: 0, message: "" }),
          );
        }
      });
    return () => c.abort();
  }, [open, workspace, assignmentId]);

  useEffect(() => {
    if (open && items && highlightId) {
      document
        .getElementById(`source-${highlightId}`)
        ?.scrollIntoView({ block: "start" });
    }
  }, [open, items, highlightId]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Sources"
      returnFocusTo={returnFocusTo}
    >
      <p className="small muted">
        Only sources you currently have access to are shown, at the version this
        work observed.
      </p>
      {error ? <ErrorNotice error={error} /> : null}
      {!items && !error ? <p className="muted">Loading…</p> : null}
      {items?.length === 0 ? (
        <p className="muted">No sources are available for this assignment.</p>
      ) : null}
      {items?.map((s) => (
        <article
          className="source-item"
          key={s.id}
          id={`source-${s.id}`}
          aria-current={highlightId === s.id ? "true" : undefined}
        >
          <div className="row row-between">
            <strong>{s.title}</strong>
            <span className="small muted">
              {s.id} @{s.version}
            </span>
          </div>
          <div className="small muted">
            {s.surface} · observed {formatTime(s.observed_at, zone)}
          </div>
          {s.used_by_artifact_ids.length ? (
            <div className="small">
              Used by:{" "}
              {s.used_by_artifact_ids
                .map((id) => artifactTitles[id] ?? id)
                .join(", ")}
            </div>
          ) : (
            <div className="small muted">Not yet used by a saved result.</div>
          )}
          {s.excerpt ? (
            <pre>{s.excerpt}</pre>
          ) : (
            <div className="small muted">Excerpt not available.</div>
          )}
        </article>
      ))}
    </Drawer>
  );
}
