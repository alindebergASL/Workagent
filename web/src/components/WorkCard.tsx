"use client";
import Link from "next/link";
import type { S } from "@/lib/client/products";
import type { WorkNow } from "@/lib/client/result-states";
import type { ResultLink } from "@/lib/result-links";
import { RESULT_NAME } from "@/lib/result-links";
import { proposalSummary, workKind, workTitle } from "@/lib/space-view";
import { readableTitle } from "@/lib/titles";
import { API_MODE } from "@/lib/client/api";
import { useCurrentWorkspace } from "@/lib/client/workspace";
import { ArtifactCitations } from "./ResearchSources";

type Body = S["Artifact"]["current_revision"]["body"];

const ROWS = 3;
const COLUMNS = 3;
const PARTS = 3;

/**
 * A few lines of the work itself, so an answer shows what it made without a
 * click. Read only and bounded; the work's own page is where it's read in
 * full and edited.
 */
export function WorkPreview({ body }: { body: Body }) {
  const b = body as Record<string, unknown>;
  if (b.kind === "structured_table") {
    const t = body as S["StructuredTableBody-Output"];
    const fields = t.fields.slice(0, COLUMNS);
    return (
      <TablePreview
        head={fields.map((f) => f.label)}
        rows={t.rows.slice(0, ROWS).map((r) =>
          fields.map((f) => {
            const v = r.cells.find((c) => c.field_key === f.key)?.value;
            return v === null || v === undefined ? "" : String(v);
          }),
        )}
        total={t.rows.length}
      />
    );
  }
  if (b.kind === "table") {
    const t = body as S["TableBody"];
    const columns = (t.columns as unknown[]).slice(0, COLUMNS).map(String);
    const rows = (t.rows as unknown[]).slice(0, ROWS).map((row) =>
      columns.map((c) => {
        const v = (row as Record<string, unknown>)?.[c];
        return v === null || v === undefined ? "" : String(v);
      }),
    );
    return <TablePreview head={columns} rows={rows} total={t.rows.length} />;
  }
  if (b.kind === "file") {
    const f = body as S["FileBody"];
    const lines = String(f.content ?? "")
      .split("\n")
      .slice(0, ROWS)
      .join("\n");
    return lines.trim() ? <pre className="work-card-file">{lines}</pre> : null;
  }
  if (b.kind === "tool")
    return (
      <p className="small muted">A tool you can run with your own inputs.</p>
    );
  if (b.kind === "custom_view")
    return (
      <p className="small muted">An interactive view. Open it to use it.</p>
    );
  if (Array.isArray(b.blocks)) {
    const blocks = (body as S["Body"]).blocks
      .map((x) => x as { kind?: string; text?: string; checked?: boolean })
      .filter((x) => x.text?.trim());
    const shown = blocks.slice(0, PARTS);
    return (
      <div className="work-card-doc">
        {shown.map((x, i) =>
          x.kind === "heading" ? (
            <p key={i} className="work-card-heading clamp-2">
              {x.text}
            </p>
          ) : (
            <p key={i} className="clamp-2">
              {x.kind === "checklist" ? (x.checked ? "☑ " : "☐ ") : ""}
              {x.text}
            </p>
          ),
        )}
        {blocks.length > shown.length ? (
          <p className="small muted">
            …and {blocks.length - shown.length} more
          </p>
        ) : null}
      </div>
    );
  }
  return null;
}

function TablePreview({
  head,
  rows,
  total,
}: {
  head: string[];
  rows: string[][];
  total: number;
}) {
  return (
    <div className="work-card-table">
      <table>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {total > rows.length ? (
        <p className="small muted">{total} rows in all</p>
      ) : null}
    </div>
  );
}

/**
 * One piece of work an answer made or changed: what it is now, a few lines of
 * it, what's waiting for the person, and the one next step. How it was
 * checked is a short plain line; the rest of the run is under "Details".
 */
export function WorkCard({
  product,
  now,
  link,
  status,
  brief = false,
  readState = "current",
}: {
  product: S["ProductResult"];
  now: WorkNow | undefined;
  link: ResultLink;
  /** How far the turn's result was checked, in a short line. */
  status?: string | null;
  /**
   * A later answer shows this work too: here it's a one-line reference,
   * without a preview (which would show today's version, not this one's).
   */
  brief?: boolean;
  /**
   * Whether the latest re-read confirmed the work: it couldn't be checked
   * (shown as last read, said so), or it can't be opened now (nothing of it
   * is shown).
   */
  readState?: "current" | "unconfirmed" | "unavailable";
}) {
  const { workspace } = useCurrentWorkspace();
  const artifact = readState === "unavailable" ? undefined : now?.artifact;
  const pending =
    product.proposal_id && now
      ? (now.proposals.find(
          (p) => p.id === product.proposal_id && p.status === "pending",
        ) ?? null)
      : null;
  const change =
    pending &&
    artifact &&
    pending.base_revision_id === artifact.current_revision_id
      ? proposalSummary(artifact.current_revision.body, pending.body)
      : null;
  return (
    <div
      className={`product-result work-card stack-xs${brief ? " brief" : ""}`}
      data-kind={product.kind}
      data-artifact={product.artifact_id}
    >
      <div className="work-card-head">
        <strong className="clamp-2">
          {artifact
            ? readableTitle(workTitle(artifact))
            : `A ${RESULT_NAME[product.kind] ?? "piece of work"}`}
        </strong>
        {artifact ? (
          <span className="small muted">{workKind(artifact)}</span>
        ) : null}
      </div>
      {artifact && !brief ? (
        <WorkPreview body={artifact.current_revision.body} />
      ) : null}
      {artifact &&
      !brief &&
      readState === "current" &&
      workspace &&
      API_MODE === "real" ? (
        <ArtifactCitations
          key={`${workspace.id}:${artifact.current_revision.id}:${artifact.current_revision.body_hash}`}
          ws={workspace.id}
          artifactId={artifact.id}
          revisionId={artifact.current_revision.id}
          bodyHash={artifact.current_revision.body_hash}
        />
      ) : null}
      {change && !brief ? (
        <p className="small work-card-change">
          <strong>Proposed:</strong> {change}
        </p>
      ) : null}
      {readState === "unavailable" ? (
        <p className="small" data-testid="work-card-unavailable">
          This work isn’t available to you now. It may have been removed, or
          your access changed.
        </p>
      ) : null}
      {readState === "unconfirmed" ? (
        <p className="small muted" data-testid="work-card-unconfirmed">
          {now
            ? "Couldn’t re-check this work just now; it’s shown as last read."
            : "Couldn’t read this work just now."}
        </p>
      ) : null}
      {link.note ? <p className="small muted">{link.note}</p> : null}
      {status && !brief ? (
        <p className="small muted" data-testid="work-card-status">
          {status}
        </p>
      ) : null}
      <div className="row wrap">
        <Link className="btn btn-sm product-link" href={link.href}>
          {link.label}
        </Link>
        {link.current ? (
          <Link className="link-quiet small" href={link.current.href}>
            {link.current.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
