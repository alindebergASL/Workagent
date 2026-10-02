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
        Source content is fetched under your current access. Observed versions
        are listed separately: the latest source may have changed since this
        work.
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
              {s.id} current @{s.version}
            </span>
          </div>
          <div className="small muted">
            {s.surface} · current source observed{" "}
            {formatTime(s.observed_at, zone)}
          </div>
          {s.observed_dependencies?.map((ref) => (
            <div className="small" key={ref.version}>
              Work observed @{ref.version} · {formatTime(ref.observed_at, zone)}
              {ref.artifact_ids.length
                ? ` · Used by: ${ref.artifact_ids.map((id) => artifactTitles[id] ?? id).join(", ")}`
                : " · Selected for this assignment"}
            </div>
          ))}
          {s.version_drift ? (
            <div className="notice notice-warn" role="status">
              This source changed after the work observed it. Historical source
              bytes are unavailable. The latest content below is not evidence
              used by artifacts that depend on an older version.
            </div>
          ) : null}
          {s.used_by_artifact_ids.length ? (
            <div className="small">
              This current version used by:{" "}
              {s.used_by_artifact_ids
                .map((id) => artifactTitles[id] ?? id)
                .join(", ")}
            </div>
          ) : (
            <div className="small muted">
              This current version is not evidence for a saved result.
            </div>
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
