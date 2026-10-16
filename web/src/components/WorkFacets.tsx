"use client";
import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { useResource } from "@/lib/client/hooks";
import { productApi, type S } from "@/lib/client/products";
import { useScopedHref } from "@/lib/client/workspace";
import {
  cellAuthors,
  flexibleKind,
  isFlexible,
  type StructuredTable,
} from "@/lib/flexible";
import {
  proposalSummary,
  workHref,
  workKind,
  workTitle,
  type SpaceWorkItem,
} from "@/lib/space-view";
import { ReadOnly, TableProposalCells } from "./FlexibleWork";

export type Facet = "view" | "source" | "changes";

/** A proposed change waiting on a piece of work the chosen work shows. */
export interface PendingChange {
  item: SpaceWorkItem;
  proposal: S["Proposal"];
}

/**
 * One piece of work with what belongs to it: what it shows, the saved work
 * it reads, and the changes waiting for the person. Tabs appear only when
 * there is more than one of these; otherwise the work is a single surface.
 * Every panel stays mounted (hidden when not chosen), so a view, its inputs
 * and any draft keep their state while the person looks elsewhere.
 */
export function WorkFacets({
  id,
  facets,
  facet,
  onFacet,
  view,
  source,
  changes,
}: {
  /** The work's id, for unique tab and panel ids. */
  id: string;
  facets: { key: Facet; label: string }[];
  facet: Facet;
  onFacet: (f: Facet) => void;
  view: ReactNode;
  source?: ReactNode;
  changes?: ReactNode;
}) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  if (facets.length < 2) return <>{view}</>;
  const panel = (key: Facet) =>
    key === "view" ? view : key === "source" ? source : changes;
  const move = (from: number, to: number) => {
    const n = facets.length;
    const i = ((to % n) + n) % n;
    onFacet(facets[i]!.key);
    tabs.current[i]?.focus();
    return from;
  };
  return (
    <div className="work-facets">
      <div className="tabs" role="tablist" aria-label="This work">
        {facets.map((f, i) => (
          <button
            key={f.key}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`facet-${id}-${f.key}`}
            aria-selected={facet === f.key}
            aria-controls={`facet-panel-${id}-${f.key}`}
            tabIndex={facet === f.key ? 0 : -1}
            className="tab"
            onClick={() => onFacet(f.key)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") move(i, i + 1);
              else if (e.key === "ArrowLeft") move(i, i - 1);
              else if (e.key === "Home") move(i, 0);
              else if (e.key === "End") move(i, facets.length - 1);
              else return;
              e.preventDefault();
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      {facets.map((f) => (
        <div
          key={f.key}
          id={`facet-panel-${id}-${f.key}`}
          role="tabpanel"
          aria-labelledby={`facet-${id}-${f.key}`}
          hidden={facet !== f.key}
          className="stack-sm"
        >
          {panel(f.key)}
        </div>
      ))}
    </div>
  );
}

/** The saved work a view reads, as saved now, each a step from its editor. */
export function SourcePanel({
  cid,
  sources,
  missing,
}: {
  cid: string;
  sources: SpaceWorkItem[];
  /** How many of the things it reads aren't in this project's work now. */
  missing: number;
}) {
  const inScope = useScopedHref();
  return (
    <div className="stack" data-testid="work-sources">
      {sources.map((s) => {
        const body = s.artifact.current_revision.body;
        return (
          <section key={s.artifact.id} className="stack-sm">
            <div className="row wrap space-source-head">
              <h3 className="small">
                {workTitle(s.artifact)}{" "}
                <span className="muted">
                  · {workKind(s.artifact)} · saved version{" "}
                  {s.artifact.current_revision.revision_number}
                </span>
              </h3>
              <Link
                className="btn btn-sm"
                href={inScope(workHref(cid, s.artifact.id))}
              >
                Open to edit
              </Link>
            </div>
            {isFlexible(body) ? (
              <ReadOnly body={body} />
            ) : (
              <p className="muted small">This opens in its own page.</p>
            )}
          </section>
        );
      })}
      {missing ? (
        <p className="small" role="note">
          {missing === 1
            ? "Something it reads isn’t available now."
            : `${missing} things it reads aren’t available now.`}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The changes waiting for the person, each against the saved version it
 * would replace. Applying stays on the work's own page, where the full
 * comparison and the explicit decision are.
 */
export function ChangesPanel({
  ws,
  cid,
  changes,
  shownId,
}: {
  ws: string;
  cid: string;
  changes: PendingChange[];
  /** The chosen work: its own changes aren't named again. */
  shownId: string;
}) {
  return (
    <div className="stack" data-testid="work-changes">
      {changes.map((c) => (
        <ChangeCard
          key={c.proposal.id}
          ws={ws}
          cid={cid}
          change={c}
          own={c.item.artifact.id === shownId}
        />
      ))}
    </div>
  );
}

function ChangeCard({
  ws,
  cid,
  change,
  own,
}: {
  ws: string;
  cid: string;
  change: PendingChange;
  own: boolean;
}) {
  const inScope = useScopedHref();
  const { item, proposal } = change;
  const aid = item.artifact.id;
  const saved = item.artifact.current_revision.body;
  const table =
    flexibleKind(saved as never) === "structured_table" &&
    flexibleKind(proposal.body as never) === "structured_table";
  // Who set each saved value, so a change to the person's own is said.
  const history = useResource(table ? `history:${ws}:${aid}` : null, (signal) =>
    productApi.history(ws, aid, signal),
  );
  const authors = table
    ? cellAuthors(item.artifact.current_revision, history.data ?? [])
    : {};
  const summary = proposalSummary(saved, proposal.body);
  return (
    <section
      className="stack-sm space-change"
      data-testid="work-change"
      data-artifact={aid}
    >
      <h3 className="small">
        {own
          ? "Proposed change"
          : `Proposed change to “${workTitle(item.artifact)}”`}
      </h3>
      {summary ? <p>{summary}</p> : null}
      {proposal.reason ? (
        <p className="small muted">{proposal.reason}</p>
      ) : null}
      {table ? (
        <TableProposalCells
          saved={saved as StructuredTable}
          proposed={proposal.body as StructuredTable}
          authors={authors}
        />
      ) : null}
      <p className="small muted">
        Your saved version stays until you apply the change.
      </p>
      <div className="row wrap">
        <Link className="btn btn-sm" href={inScope(workHref(cid, aid))}>
          Review and decide
        </Link>
      </div>
    </section>
  );
}
