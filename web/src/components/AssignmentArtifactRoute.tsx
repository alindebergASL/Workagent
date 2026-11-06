"use client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { clearDraft } from "@/lib/draft";
import { useResource } from "@/lib/client/hooks";
import { client, meta, unwrap } from "@/lib/client/real-api";
import { isProduct, productApi, type S } from "@/lib/client/products";
import type { WorkspaceScope } from "@/lib/client/workspace";
import { ApiError } from "@/lib/contract/errors";
import { isFlexible } from "@/lib/flexible";
import { scopedHref } from "@/lib/scope";
import { ProductView } from "./ProductView";
import { ReadOnly } from "./FlexibleWork";
import { ErrorNotice } from "./ui";

/** The URL owner is checked independently of the body's rendering shape. */
export async function loadAssignmentArtifact(
  ws: string,
  owner: string,
  id: string,
  revision: string | null,
  signal: AbortSignal,
) {
  const artifact = await unwrap(
    client.GET("/v1/workspaces/{workspace_id}/artifacts/{artifact_id}", {
      params: {
        path: { workspace_id: ws, artifact_id: id },
        header: meta(),
        query: { revision_id: revision ?? undefined },
      },
      signal,
    }),
  );
  if (
    artifact.workspace_id !== ws ||
    artifact.id !== id ||
    artifact.assignment_id !== owner ||
    artifact.conversation_id ||
    (artifact.requested_revision?.id ?? null) !== revision
  )
    throw new ApiError({
      code: "not_found_or_not_authorized",
      status: 404,
      message: "This saved output is not available at this assignment.",
    });
  return artifact;
}

/** Keep the document editor; read other saved shapes at their actual owner. */
export function AssignmentArtifactRoute({
  scope,
  children,
}: {
  scope: WorkspaceScope;
  children: ReactNode;
}) {
  const { id: owner, artifactId: id } = useParams<{
    id: string;
    artifactId: string;
  }>();
  const revision = useSearchParams().get("revision_id");
  const { wsId: ws } = scope;
  const res = useResource<S["Artifact"]>(
    ws
      ? `assignment-artifact:${ws}:${owner}:${id}:${revision ?? "current"}`
      : null,
    (signal) => loadAssignmentArtifact(ws!, owner, id, revision, signal),
    { pollMs: 2500 },
  );
  // useResource may retain the previous key's data until its effect runs.
  // Never render it at a different owner, workspace, artifact or revision URL.
  const raw = res.data;
  const artifact =
    raw &&
    raw.workspace_id === ws &&
    raw.id === id &&
    raw.assignment_id === owner &&
    !raw.conversation_id &&
    (raw.requested_revision?.id ?? null) === revision
      ? raw
      : null;
  const selected = artifact?.requested_revision ?? artifact?.current_revision;
  const document = selected && "blocks" in selected.body;
  const history = useResource<S["Revision"][]>(
    ws && artifact && !document
      ? `assignment-product-history:${ws}:${owner}:${id}:${artifact.current_revision_id}`
      : null,
    (signal) => productApi.history(ws!, id, signal),
  );
  useEffect(() => {
    if (
      [res.error, history.error].some(
        (error) =>
          error?.code === "not_found_or_not_authorized" ||
          error?.code === "unauthenticated",
      )
    )
      clearDraft(id);
  }, [res.error, history.error, id]);
  const back = (
    <Link className="back-link" href={scopedHref(`/assignments/${owner}`, ws)}>
      ← Back to the assignment
    </Link>
  );
  if (!artifact || !selected)
    return (
      <div className="agent-col">
        {back}
        {res.error ? (
          <ErrorNotice error={res.error} />
        ) : (
          <p aria-busy="true">Loading saved work…</p>
        )}
      </div>
    );
  if (document) return children;
  // A denied history read must not leave previously loaded revision bodies visible.
  if (
    history.error?.code === "not_found_or_not_authorized" ||
    history.error?.code === "unauthenticated"
  )
    return (
      <div className="agent-col">
        {back}
        <ErrorNotice error={history.error} />
      </div>
    );
  const body = selected.body;
  const href = (rid?: string) =>
    scopedHref(
      `/assignments/${owner}/artifacts/${id}${rid ? `?revision_id=${encodeURIComponent(rid)}` : ""}`,
      ws,
    );
  return (
    <div className="doc-page">
      <header className="doc-head">
        {back}
        <h1>{body.title}</h1>
        <p>
          Revision {selected.revision_number} ·{" "}
          {selected.author_kind === "human"
            ? "Saved by you"
            : "Saved by Workagent"}
        </p>
        {selected.id !== artifact.current_revision_id ? (
          <p role="status">
            Viewing an earlier revision (not the current version).{" "}
            <Link href={href()}>Show current version</Link>
          </p>
        ) : null}
        <p className="hint">
          Read-only saved output. Opening this page does not run work or change
          your edits.
        </p>
        <button
          className="btn btn-sm"
          type="button"
          onClick={() => void res.refresh()}
        >
          Refresh saved output
        </button>
        {res.reconnecting ? <p role="status">Reconnecting…</p> : null}
      </header>
      <section className="doc-card" data-testid="assignment-product-body">
        {isProduct(body) ? (
          <ProductView body={body} />
        ) : isFlexible(body) ? (
          <ReadOnly body={body} />
        ) : null}
        {isProduct(body) && "notes" in body && body.notes?.length ? (
          <section aria-label="Saved notes">
            <h2>Notes</h2>
            <ul>
              {body.notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>
      <details className="disclosure">
        <summary>Saved revisions</summary>
        {history.error ? (
          <ErrorNotice error={history.error} />
        ) : (
          <ul>
            {(history.current ? history.data : [])
              ?.filter((item) => item.artifact_id === id)
              .map((item) => (
                <li key={item.id}>
                  <Link href={href(item.id)}>
                    Revision {item.revision_number} · {item.body.title}
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </details>
    </div>
  );
}
