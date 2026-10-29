"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ConnectorController,
  type ConnectorStatus,
  type ConnectorView,
  type Intent,
  type Notice,
} from "@/lib/client/connectors";

/**
 * Connections for one workspace. Only the synthetic sample library can be
 * connected; private accounts aren't offered. State lives in a controller
 * bound to the workspace, so switching workspace or leaving drops anything
 * shown or in flight for the old one.
 */
export function ConnectorPanel({
  wsId,
  zone,
  controller,
}: {
  wsId: string | null;
  zone: string;
  /** Tests only. */
  controller?: ConnectorController;
}) {
  const [ctl] = useState(() => controller ?? new ConnectorController());
  // Unbinding on switch or unmount drops what was shown and in flight.
  useEffect(() => {
    ctl.bind(wsId);
    return () => ctl.bind(null);
  }, [ctl, wsId]);
  const view = useSyncExternalStore(ctl.subscribe, ctl.snapshot, ctl.snapshot);
  return (
    <ConnectorPanelView
      view={view}
      zone={zone}
      onStart={() => void ctl.start()}
      onConfirm={() => void ctl.confirm()}
      onCancel={() => ctl.cancel()}
      onRevoke={(id) => void ctl.revoke(id)}
      onRefresh={() => void ctl.refresh()}
      onRetry={(a) => {
        if (a === "start") void ctl.start();
        else if (a === "confirm") void ctl.confirm();
        else void ctl.revoke(a.slice("revoke:".length));
      }}
    />
  );
}

const STATE_LABEL: Record<ConnectorStatus["state"], string> = {
  connected: "Connected · read only",
  revoked: "Local access revoked",
  expired: "Expired",
  unavailable: "Unavailable",
};

/** What the provider side has confirmed; never implies more than it has. */
export function providerLine(s: ConnectorStatus): string | null {
  switch (s.provider_revocation) {
    case "pending":
      return "Provider revocation pending: not yet confirmed by the provider.";
    case "failed":
      return "Provider revocation failed: the provider hasn’t confirmed removal.";
    case "revoked":
      return "Provider revocation confirmed.";
    default:
      return s.state === "revoked"
        ? "Provider revocation not requested."
        : null;
  }
}

function when(iso: string, zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString();
  }
}

function noticeCopy(n: Notice): string {
  switch (n.kind) {
    case "denied":
      return "Connections for this workspace aren’t available to you. Nothing from before is shown.";
    case "unknown":
      return "Couldn’t confirm whether that went through. Retry sends the same request, not a new one.";
    case "refused":
      return "That wasn’t accepted. Nothing changed.";
    case "changed":
      return "Access changed since this was shown. Showing the current status.";
    case "unreadable":
      return "Couldn’t load connections.";
  }
}

export function ConnectorPanelView({
  view,
  zone,
  onStart,
  onConfirm,
  onCancel,
  onRevoke,
  onRefresh,
  onRetry,
}: {
  view: ConnectorView;
  zone: string;
  onStart: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onRevoke: (id: string) => void;
  onRefresh: () => void;
  onRetry: (a: Intent) => void;
}) {
  const { items, flow, busy, notice, loading } = view;
  const connected = items?.some((s) => s.state === "connected") ?? false;
  return (
    <section
      className="connector-panel"
      aria-labelledby="connector-heading"
      data-testid="connector-panel"
    >
      <h1 id="connector-heading">Connections</h1>
      <p className="connector-mode" role="note" data-testid="synthetic-mode">
        <strong>Synthetic only.</strong> This connects a made-up local sample
        library, with no sign-in and no private account data. Connecting real
        accounts isn’t available yet.
      </p>

      {notice ? (
        <div
          className="connector-notice"
          role="status"
          data-notice={notice.kind}
        >
          <p>{noticeCopy(notice)}</p>
          {notice.kind === "unknown" ? (
            <button
              type="button"
              onClick={() => onRetry(notice.action)}
              disabled={!!busy}
            >
              Retry
            </button>
          ) : notice.kind === "unreadable" || notice.kind === "denied" ? (
            <button type="button" onClick={onRefresh} disabled={loading}>
              Check again
            </button>
          ) : null}
        </div>
      ) : null}

      {items === null ? (
        loading ? (
          <p className="connector-muted" role="status">
            Loading connections…
          </p>
        ) : null
      ) : (
        <ul className="connector-list" data-testid="connector-list">
          {items.length === 0 ? (
            <li className="connector-muted" data-testid="connector-empty">
              Nothing connected.
            </li>
          ) : null}
          {items.map((s) => {
            const provider = providerLine(s);
            return (
              <li
                key={s.connector_id}
                className="connector-row"
                data-state={s.state}
                data-provider-revocation={s.provider_revocation}
              >
                <div className="connector-row-main">
                  <strong>{s.account}</strong>
                  <span className="connector-resource">{s.resource}</span>
                  <span className="connector-state">
                    {STATE_LABEL[s.state]}
                  </span>
                  {provider ? (
                    <span
                      className="connector-provider"
                      data-testid="provider-revocation"
                    >
                      {provider}
                    </span>
                  ) : null}
                  <span className="connector-muted">
                    {s.state === "connected"
                      ? "Access ends "
                      : "Access ended or ends "}
                    {when(s.expires_at, zone)}
                  </span>
                </div>
                {s.state === "connected" ? (
                  <button
                    type="button"
                    onClick={() => onRevoke(s.connector_id)}
                    disabled={!!busy}
                  >
                    {busy === `revoke:${s.connector_id}`
                      ? "Revoking…"
                      : "Revoke access"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {flow ? (
        <div className="connector-consent" data-testid="connector-consent">
          <h2>Review before connecting</h2>
          <dl>
            <dt>Account</dt>
            <dd>{flow.account}</dd>
            <dt>Resource</dt>
            <dd>{flow.resource}</dd>
            <dt>Access</dt>
            <dd>Read only. Nothing is changed or sent.</dd>
            <dt>Processed by</dt>
            <dd>Local synthetic service ({flow.processor})</dd>
            <dt>Kept</dt>
            <dd>Synthetic data only; no private account access.</dd>
            <dt>Offer expires</dt>
            <dd>{when(flow.expires_at, zone)}</dd>
          </dl>
          <div className="connector-actions">
            <button
              type="button"
              className="primary"
              onClick={onConfirm}
              disabled={!!busy}
            >
              {busy === "confirm"
                ? "Connecting…"
                : "Confirm synthetic connection"}
            </button>
            <button type="button" onClick={onCancel} disabled={!!busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : items !== null && !connected ? (
        <button
          type="button"
          className="primary"
          onClick={onStart}
          disabled={!!busy}
          data-testid="connector-start"
        >
          {busy === "start" ? "Preparing…" : "Connect synthetic library"}
        </button>
      ) : null}
    </section>
  );
}
