"use client";
import Link from "next/link";
import type { components } from "../../../contracts/src/client";
import { condenseDiff, countChanges, diffBlocks } from "@/lib/diff";
import { viewBlocks } from "@/lib/document-blocks";

type S = components["schemas"];

/**
 * Who a saved version came from, from the records: a proposal's accepted
 * revision is Workagent's change that a person applied; otherwise the
 * revision's own author. Never inferred from what the content says.
 */
export function versionAuthor(
  revision: S["Revision"],
  proposals: S["Proposal"][],
): string {
  if (proposals.some((p) => p.accepted_revision_id === revision.id))
    return "Workagent’s change, applied by you";
  return revision.author_kind === "human" ? "your edit" : "Workagent";
}

/**
 * Opened from a conversation link to an earlier saved version: says which
 * version that was and that the work has changed since, lists the later
 * versions with who saved each, and for documents shows what changed. The
 * current version below stays the one people edit.
 */
export function EarlierVersion({
  revisionId,
  current,
  history,
  proposals,
  workHref,
  render,
}: {
  revisionId: string;
  current: S["Revision"];
  history: S["Revision"][];
  proposals: S["Proposal"][];
  workHref: string;
  render: (body: S["Revision"]["body"]) => React.ReactNode;
}) {
  if (revisionId === current.id) return null;
  const earlier = history.find((r) => r.id === revisionId);
  if (!earlier)
    return (
      <p className="notice-line" role="status" data-testid="earlier-version">
        That version isn’t in this work’s saved history. Showing the current
        version.
      </p>
    );
  const later = history
    .filter((r) => r.revision_number > earlier.revision_number)
    .sort((a, b) => a.revision_number - b.revision_number);
  const docs =
    "blocks" in earlier.body && "blocks" in current.body
      ? diffBlocks(
          viewBlocks(earlier.body.blocks),
          viewBlocks(current.body.blocks),
        )
      : null;
  const counts = docs ? countChanges(docs) : null;
  return (
    <section
      className="card earlier-version stack-sm"
      aria-labelledby="earlier-version-title"
      data-testid="earlier-version"
    >
      <p className="eyebrow-caps">From the conversation</p>
      <h2 id="earlier-version-title">
        Version {earlier.revision_number} · {versionAuthor(earlier, proposals)}
      </h2>
      <p>
        This work has changed since. The current version, version{" "}
        {current.revision_number}, is below.
      </p>
      <ul className="small later-versions">
        {later.map((r) => (
          <li key={r.id}>
            Version {r.revision_number} · {versionAuthor(r, proposals)}
          </li>
        ))}
      </ul>
      {docs && counts ? (
        <details className="disclosure">
          <summary>
            What changed since version {earlier.revision_number} ({counts.added}{" "}
            added, {counts.removed} removed)
          </summary>
          <div className="disclosure-body">
            <ul className="version-diff">
              {condenseDiff(docs).map((op, i) =>
                op.type === "gap" ? (
                  <li key={i} className="muted small">
                    {op.count} unchanged
                  </li>
                ) : op.type === "same" ? null : (
                  <li key={i} data-change={op.type}>
                    <span className="sr-only">
                      {op.type === "added" ? "Added: " : "Removed: "}
                    </span>
                    {op.block.kind === "check_item"
                      ? `${op.block.checked ? "☑" : "☐"} ${op.block.text}`
                      : op.block.text}
                  </li>
                ),
              )}
            </ul>
          </div>
        </details>
      ) : null}
      <details className="disclosure">
        <summary>Show version {earlier.revision_number}</summary>
        <div className="disclosure-body">{render(earlier.body)}</div>
      </details>
      <p className="small">
        <Link href={workHref}>Show only the current version</Link>
      </p>
    </section>
  );
}
