"use client";
import { useEffect, useState } from "react";
import type { ArtifactHistory } from "@/lib/contract/types";
import { api } from "@/lib/client/api";
import { ApiError } from "@/lib/contract/errors";
import { useWorkspace } from "@/lib/client/workspace";
import { formatTime } from "@/lib/time";
import { Drawer, ErrorNotice } from "./ui";

export function HistoryDrawer({
  open,
  onClose,
  artifactId,
  onView,
  returnFocusTo,
  refreshKey,
}: {
  open: boolean;
  onClose: () => void;
  artifactId: string;
  onView: (revisionId: string | null) => void;
  returnFocusTo?: React.RefObject<HTMLElement | null>;
  refreshKey: string;
}) {
  const { workspace, zone } = useWorkspace();
  const [history, setHistory] = useState<ArtifactHistory | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open || !workspace) return;
    const c = new AbortController();
    setHistory(null);
    setError(null);
    api
      .getArtifactHistory(workspace.id, artifactId, c.signal)
      .then(setHistory)
      .catch((e: unknown) => {
        if (!c.signal.aborted)
          setError(
            e instanceof ApiError
              ? e
              : new ApiError({ code: "transport", status: 0, message: "" }),
          );
      });
    return () => c.abort();
  }, [open, workspace, artifactId, refreshKey]);

  const proposalLabel: Record<string, string> = {
    generating: "Drafting",
    proposed: "Proposed, awaiting your review",
    conflicted: "Needs review (based on an older revision)",
    accepted: "Applied",
    declined: "Kept current version instead",
    superseded: "Superseded",
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="History"
      returnFocusTo={returnFocusTo}
    >
      <p className="small muted">
        Viewing an older revision never changes the current one. To bring it
        back, edit and save a new revision.
      </p>
      {error ? <ErrorNotice error={error} /> : null}
      {!history && !error ? <p className="muted">Loading…</p> : null}
      {history ? (
        <>
          <h3>Revisions</h3>
          <div>
            {history.revisions.map((r) => (
              <article className="history-item" key={r.id}>
                <div className="row row-between">
                  <strong>
                    Revision {r.sequence}
                    {r.id === history.accepted_revision_id ? " · current" : ""}
                  </strong>
                  <span className="small muted">{r.id}</span>
                </div>
                <div className="small muted">
                  {r.author.kind === "human"
                    ? r.author.name
                    : "Workagent (agent draft)"}{" "}
                  · {formatTime(r.created_at, zone)}
                </div>
                {r.note ? <div className="small">{r.note}</div> : null}
                <div className="row">
                  {r.id === history.accepted_revision_id ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => onView(null)}
                    >
                      Show current
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => onView(r.id)}
                    >
                      View this revision
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {history.proposals.length ? (
            <>
              <h3>Proposals</h3>
              <div>
                {history.proposals.map((p) => (
                  <article className="history-item" key={p.id}>
                    <div className="row row-between">
                      <strong>
                        Proposal based on revision {p.base_sequence}
                      </strong>
                      <span className="small muted">{p.id}</span>
                    </div>
                    <div className="small muted">
                      {proposalLabel[p.status] ?? p.status} ·{" "}
                      {formatTime(p.updated_at, zone)}
                    </div>
                    <div className="small">{p.reason}</div>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </Drawer>
  );
}
