"use client";
import { useEffect, useRef, useState } from "react";
import { client, unwrap, meta } from "@/lib/client/real-api";
import {
  computeReceipt,
  DOWNLOAD_WITHDRAWN,
  isComputeAttempt,
  receiptKey,
  withdrawReceipt,
  type Withdrawn,
  scopedRequests,
  toolAttemptRow,
  type ToolAttemptView,
} from "@/lib/tool-activity";
import { ComputeReceipt } from "./ComputeReceipt";
import { describeError } from "@/lib/contract/errors";

/**
 * Secondary, on-demand view of recorded tool attempts for one run. Loads when
 * opened and on an explicit refresh — no polling — and shows exactly what the
 * adapter observed: state, cost, omissions, truncation. Computation receipts
 * are validated before display; "observed" means a receipt was recorded. It never claims model
 * execution beyond the recorded adapter observation.
 */
export function ToolActivity({ ws, runId }: { ws: string; runId: string }) {
  // Data is keyed by workspace+run; anything loaded for another scope is
  // never rendered, and late responses from superseded requests are dropped.
  const [data, setData] = useState<{
    key: string;
    items: ToolAttemptView[];
  } | null>(null);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawn, setWithdrawn] = useState<Withdrawn>(new Map());
  const requests = useRef(scopedRequests());
  const details = useRef<HTMLDetailsElement>(null);
  const scopeKey = `${ws}\u0000${runId}`;

  async function load(after: string | null) {
    const token = requests.current.begin(ws, runId);
    setLoading(true);
    setError(null);
    if (after === null) {
      // A refresh never leaves earlier results on screen while it is pending.
      setData(null);
      setNextAfter(null);
    }
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
      if (!requests.current.isCurrent(token, ws, runId)) return;
      setData((prev) => ({
        key: token.key,
        items:
          after && prev?.key === token.key
            ? [...prev.items, ...page.items]
            : page.items,
      }));
      setNextAfter(page.next_after ?? null);
      // Only an explicit successful refresh restores withdrawn receipts.
      if (after === null) setWithdrawn(new Map());
    } catch (e) {
      if (!requests.current.isCurrent(token, ws, runId)) return;
      // A failed or refused refresh clears old data rather than leaving it
      // on screen as if it were current.
      setData(null);
      setNextAfter(null);
      const d = describeError(e);
      setError(`${d.title}. ${d.nextAction}`);
    } finally {
      if (requests.current.isCurrent(token, ws, runId)) setLoading(false);
    }
  }

  useEffect(() => {
    requests.current.invalidate();
    setData(null);
    setWithdrawn(new Map());
    setNextAfter(null);
    setError(null);
    setLoading(false);
    if (details.current?.open) void load(null);
  }, [ws, runId]);

  // Responses arriving after unmount are discarded.
  useEffect(() => {
    const r = requests.current;
    return () => r.invalidate();
  }, []);

  const items = data?.key === scopeKey ? data.items : null;
  const rows = (items ?? []).map((a) => toolAttemptRow(a, ws));
  const receipts = new Map(
    (items ?? [])
      .filter(isComputeAttempt)
      .map((a) => [a.attempt_id, computeReceipt(a, ws)] as const),
  );
  return (
    <details
      ref={details}
      className="ids-details tool-activity"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open && items === null && !loading)
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
            <li
              key={r.attemptId}
              className="card card-quiet"
              style={{ minWidth: 0, overflowWrap: "anywhere" }}
            >
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
              {withdrawn.has(receiptKey(ws, runId, r.attemptId)) ? (
                <p
                  className="hint"
                  role="alert"
                  data-testid="receipt-withdrawn"
                >
                  {DOWNLOAD_WITHDRAWN}{" "}
                  {withdrawn.get(receiptKey(ws, runId, r.attemptId))}
                </p>
              ) : receipts.has(r.attemptId) ? (
                <ComputeReceipt
                  key={`${scopeKey}:${r.attemptId}`}
                  ws={ws}
                  receipt={receipts.get(r.attemptId)!}
                  onInvalidate={(reason) => {
                    // Bound to the scope this receipt was rendered under; a
                    // late callback for an older scope cannot mark the new one.
                    const key = receiptKey(ws, runId, r.attemptId);
                    setWithdrawn((w) => withdrawReceipt(w, key, reason));
                  }}
                />
              ) : null}
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
