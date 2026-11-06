"use client";

import {
  KIND_LABEL,
  STATUS_LABEL,
  type HumanMemorySummary,
} from "@/lib/memory-contract";

/** Human discovery is a page of summaries, never a model prompt pack. */
export function MemoryDiscovery({
  items,
  disabled,
  onOpen,
}: {
  items: HumanMemorySummary[];
  disabled: boolean;
  onOpen: (summary: HumanMemorySummary) => void;
}) {
  if (!items.length) return null;
  return (
    <section className="stack-sm" aria-label="Memory discovery">
      <p className="small muted">
        Summaries in stable memory order. Open a memory for its full text and
        controls. Disputed memories remain disputed even when other members are
        on another page.
      </p>
      <ul className="stack-sm" style={{ listStyle: "none", padding: 0 }}>
        {items.map((summary) => (
          <li key={summary.memory_id} className="card stack-sm">
            <p>{summary.excerpt}</p>
            <p className="small muted">
              {KIND_LABEL[summary.kind]} · {STATUS_LABEL[summary.status]}
              {summary.unresolved_conflict
                ? " · Unresolved conflict; other members may be on another page"
                : ""}
            </p>
            <button
              className="btn btn-sm"
              disabled={disabled}
              onClick={() => onOpen(summary)}
            >
              Open full memory
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
