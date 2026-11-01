"use client";
import { checkpointPage, type CheckpointPage } from "@/lib/client/human-history";
import { useDiscoveryPage } from "@/lib/client/discovery-page";

export function HistoryNavigation({ loading, unavailable, hasMore, hasPrevious, next, first, refresh }: {
  loading: boolean; unavailable: boolean; hasMore: boolean; hasPrevious: boolean;
  next: () => void; first: () => void; refresh: () => void;
}) {
  return <div className="stack">
    <p className="hint" role="status">{loading ? "Reading saved history…" : unavailable
      ? "History could not be confirmed. Refresh from the start to check current access."
      : hasMore ? "More authorized results are available." : "End of the current authorized listing."}</p>
    <div className="actions">
      <button type="button" className="btn btn-secondary" onClick={refresh}>Refresh this page</button>
      {hasPrevious || unavailable ? <button type="button" className="btn btn-secondary" onClick={first}>From the start</button> : null}
      {hasMore ? <button type="button" className="btn btn-secondary" disabled={loading || unavailable} onClick={next}>Next page</button> : null}
    </div>
  </div>;
}

/** History is deliberately not an input to ContinueRun. No command controls. */
export function CheckpointHistoryItems({ items }: { items: CheckpointPage["items"] }) {
  return <ul className="work-list">{items.map((item) => <li key={item.checkpoint_id}>
    <p><time dateTime={item.created_at}>{item.created_at}</time> · {item.checkpoint_kind} · {item.phase}</p>
    <p className="small muted">{item.data.waiting} · {item.data.next_safe_action} · History only; this does not start or replay work.</p>
  </li>)}</ul>;
}

export function CheckpointHistory({ ws, cid, workVersion }: { ws: string; cid: string; workVersion: number }) {
  const history = useDiscoveryPage(`checkpoint-history:${ws}:${cid}:${workVersion}`,
    (signal, after) => checkpointPage(ws, cid, signal, after));
  return <details className="status-more" data-testid="checkpoint-history">
    <summary>Saved checkpoint history</summary>
    <p className="hint">Newest first. Pages show current access, not a frozen snapshot. Refresh from the start for new checkpoints.</p>
    <HistoryNavigation loading={history.loading} unavailable={history.unavailable}
      hasMore={Boolean(history.page?.has_more)} hasPrevious={history.hasPrevious}
      next={history.next} first={history.first} refresh={() => void history.refresh()} />
    <CheckpointHistoryItems items={history.page?.items ?? []} />
  </details>;
}
