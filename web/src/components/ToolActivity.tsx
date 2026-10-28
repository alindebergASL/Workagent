"use client";
import { useRef, useState } from "react";
import { client, unwrap, meta } from "@/lib/client/real-api";
import { toolAttemptRow, type ToolAttemptView } from "@/lib/tool-activity";
import { describeError } from "@/lib/contract/errors";

/**
 * Secondary, on-demand view of recorded tool attempts for one run. Loads when
 * opened and on an explicit refresh — no polling — and shows exactly what the
 * adapter observed: state, cost, omissions, truncation. It never claims model
 * execution beyond the recorded adapter observation.
 */
export function ToolActivity({ ws, runId }: { ws: string; runId: string }) {
  const [items, setItems] = useState<ToolAttemptView[] | null>(null);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

  async function load(after: string | null) {
    setLoading(true);
    setError(null);
    try {
      const page = await unwrap(
        client.GET(
          "/v1/workspaces/{workspace_id}/runs/{run_id}/tool-attempts",
          {
            params: {
              path: { workspace_id: ws, run_id: runId },
              query: after ? { after } : {},
              header: meta(),
            },
          },
        ),
      );
      setItems((prev) =>
        after && prev ? [...prev, ...page.items] : page.items,
      );
      setNextAfter(page.next_after ?? null);
      loadedFor.current = runId;
    } catch (e) {
      const d = describeError(e);
      setError(`${d.title}. ${d.nextAction}`);
    } finally {
      setLoading(false);
    }
  }

  const stale = loadedFor.current !== null && loadedFor.current !== runId;
  const rows = (items ?? []).map(toolAttemptRow);
  return (
    <details
      className="ids-details tool-activity"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open && (items === null || stale))
          void load(null);
      }}
    >
      <summary>Tool activity</summary>
      <div className="stack-sm" style={{ marginTop: 8 }}>
        <p className="small muted">
          Recorded tool calls for the latest run, as the tool adapter observed
          them. This lists what actually ran and what it cost — it isn’t a claim
          about anything else the model did.
        </p>
        {error ? (
          <p className="hint" role="alert">
            {error}
          </p>
        ) : null}
        {items !== null && rows.length === 0 && !error ? (
          <p className="small muted">
            No tool calls were recorded for this run.
          </p>
        ) : null}
        <ul className="stack-sm" style={{ listStyle: "none", padding: 0 }}>
          {rows.map((r) => (
            <li key={r.attemptId} className="card card-quiet">
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                <strong className="small">{r.capability}</strong>
                <span
                  className={`small ${r.tone === "ok" ? "muted" : ""}`}
                  data-tone={r.tone}
                >
                  {r.stateLabel}
                </span>
              </div>
              {r.errorLabel ? <p className="small">{r.errorLabel}</p> : null}
              {r.costLine ? <p className="small muted">{r.costLine}</p> : null}
              {r.truncated ? (
                <p className="small muted">Recorded output was truncated.</p>
              ) : null}
              {r.omissions.length > 0 ? (
                <p className="small muted">
                  Not shown: {r.omissions.join("; ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="row">
          {nextAfter ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void load(nextAfter)}
              disabled={loading}
            >
              Show more
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => void load(null)}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>
    </details>
  );
}
