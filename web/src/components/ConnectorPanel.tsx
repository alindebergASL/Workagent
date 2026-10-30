"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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

/** True once an ISO time has passed. */
function past(iso: string): boolean {
  return Date.parse(iso) <= Date.now();
}

/**
 * Busy, not disabled: a disabled button drops keyboard focus to the page,
 * so a busy one stays focusable and ignores the press.
 */
function held(unavailable: boolean, act: () => void) {
  return {
    "aria-disabled": unavailable || undefined,
    onClick: () => {
      if (!unavailable) act();
    },
  };
}

/** A press waiting for its answer, and what was shown when it was made. */
interface Pending {
  readonly intent: Intent | "cancel" | "refresh";
  readonly ids: readonly string[];
}

/** Where focus goes once a press settles; `lost` only if it fell to the page. */
type FocusTo =
  | { to: "consent" | "start" | "panel"; lost?: boolean }
  | { to: "row"; id: string; lost?: boolean };

/** What the press came to: an outcome line and where focus goes next. */
function settle(
  p: Pending,
  view: ConnectorView,
): { line: string; focus: FocusTo } {
  const { items, flow, notice } = view;
  const lost = { to: "panel", lost: true } as const;
  if (notice) return { line: "", focus: lost };
  if (p.intent === "start")
    return flow
      ? { line: "", focus: { to: "consent" } }
      : { line: "", focus: lost };
  if (p.intent === "cancel")
    return {
      line: "Cancelled. Nothing was connected.",
      focus: { to: "start" },
    };
  if (p.intent === "confirm") {
    if (flow) return { line: "", focus: lost };
    const made =
      items?.find((s) => !p.ids.includes(s.connector_id)) ??
      items?.find((s) => s.state === "connected");
    return made?.state === "connected"
      ? {
          line: `Connected: ${made.account}, read only.`,
          focus: { to: "row", id: made.connector_id },
        }
      : { line: "", focus: lost };
  }
  if (p.intent.startsWith("revoke:")) {
    const id = p.intent.slice("revoke:".length);
    const s = items?.find((x) => x.connector_id === id);
    if (!s || s.state === "connected") return { line: "", focus: lost };
    const provider = providerLine(s);
    return {
      line: `${s.account}: ${STATE_LABEL[s.state]}.${provider ? ` ${provider}` : ""}`,
      focus: { to: "row", id },
    };
  }
  return { line: "", focus: lost };
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
  const { items, flow, busy, notice, loading, confirmedAt, staleSince } = view;
  const connected = items?.some((s) => s.state === "connected") ?? false;

  // Each press is followed to its answer: the outcome is announced in the
  // one status line and focus moves to what replaced the pressed control.
  const [pending, setPending] = useState<Pending | null>(null);
  const [line, setLine] = useState("");
  const [focusReq, setFocusReq] = useState<FocusTo | null>(null);
  const [seen, setSeen] = useState(view);
  if (seen !== view) {
    setSeen(view);
    if (pending && !view.busy && !view.loading) {
      const next = settle(pending, view);
      setPending(null);
      setLine(next.line);
      setFocusReq(next.focus);
    }
  }
  const press = (intent: Pending["intent"], act: () => void) => {
    setPending({ intent, ids: items?.map((s) => s.connector_id) ?? [] });
    setLine("");
    act();
  };

  const headingRef = useRef<HTMLHeadingElement>(null);
  const consentRef = useRef<HTMLHeadingElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const lost = () =>
    !document.activeElement || document.activeElement === document.body;
  // While a press is out, a control that went away leaves focus on the
  // page; hold it on the panel heading until the answer arrives.
  useEffect(() => {
    if (pending && lost()) headingRef.current?.focus();
  }, [pending, view]);
  // Once per settled press: focus what replaced the pressed control.
  useEffect(() => {
    if (!focusReq || (focusReq.lost && !lost())) return;
    const el =
      focusReq.to === "consent"
        ? consentRef.current
        : focusReq.to === "start"
          ? startRef.current
          : focusReq.to === "row"
            ? (rowRefs.current.get(focusReq.id) ?? null)
            : null;
    (el ?? headingRef.current)?.focus();
  }, [focusReq]);

  const status = notice
    ? noticeCopy(notice)
    : line || (loading ? "Loading connections…" : "");

  return (
    <section
      className="connector-panel"
      aria-labelledby="connector-heading"
      data-testid="connector-panel"
    >
      <h1 id="connector-heading" ref={headingRef} tabIndex={-1}>
        Connections
      </h1>
      <p className="connector-mode" role="note" data-testid="synthetic-mode">
        <strong>Synthetic only.</strong> This connects a made-up local sample
        library, with no sign-in and no private account data. Connecting real
        accounts isn’t available yet.
      </p>

      {/* The one live region: notices, outcomes and loading are announced
          here; the visible copies below aren't live. */}
      <p className="sr-only" role="status" data-testid="connector-outcome">
        {status}
      </p>

      {notice ? (
        <div className="connector-notice" data-notice={notice.kind}>
          <p>{noticeCopy(notice)}</p>
          {notice.kind === "unknown" ? (
            <button
              type="button"
              className="btn btn-sm"
              {...held(!!busy, () =>
                press(notice.action, () => onRetry(notice.action)),
              )}
            >
              Retry
            </button>
          ) : notice.kind === "unreadable" || notice.kind === "denied" ? (
            <button
              type="button"
              className="btn btn-sm"
              {...held(loading, () => press("refresh", onRefresh))}
            >
              Check again
            </button>
          ) : null}
        </div>
      ) : null}

      {items === null ? (
        loading ? (
          <p className="connector-muted">Loading connections…</p>
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
            const at = confirmedAt?.[s.connector_id];
            // Not confirmed since a failed read, or a revoke whose answer
            // never came: only what was last confirmed, never current.
            const stale =
              (!!staleSince && (!at || at <= staleSince)) ||
              (notice?.kind === "unknown" &&
                notice.action === `revoke:${s.connector_id}`);
            const expired = s.state === "connected" && past(s.expires_at);
            const label = expired ? "Expired" : STATE_LABEL[s.state];
            const mainId = `connector-${s.connector_id}`;
            return (
              <li
                key={s.connector_id}
                className="connector-row"
                data-state={s.state}
                data-expired={expired || undefined}
                data-stale={stale || undefined}
                data-provider-revocation={s.provider_revocation}
              >
                <div className="connector-row-main" id={mainId}>
                  <strong>{s.account}</strong>
                  <span className="connector-resource">{s.resource}</span>
                  <span
                    className="connector-state"
                    tabIndex={-1}
                    ref={(el) => {
                      if (el) rowRefs.current.set(s.connector_id, el);
                      else rowRefs.current.delete(s.connector_id);
                    }}
                  >
                    {stale ? (
                      <span data-testid="connector-stale">
                        {at
                          ? `Not confirmed now. Last confirmed ${when(at, zone)}: ${label.toLowerCase()}.`
                          : "Not confirmed now."}
                      </span>
                    ) : (
                      label
                    )}
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
                    {expired
                      ? "Access ended "
                      : s.state === "connected"
                        ? "Access ends "
                        : "Access ended or ends "}
                    {when(s.expires_at, zone)}
                    {expired
                      ? " (the service still lists it as connected)"
                      : ""}
                  </span>
                </div>
                {s.state === "connected" ? (
                  <button
                    type="button"
                    className="btn"
                    aria-describedby={mainId}
                    {...held(!!busy, () =>
                      press(`revoke:${s.connector_id}`, () =>
                        onRevoke(s.connector_id),
                      ),
                    )}
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
          <h2 ref={consentRef} tabIndex={-1}>
            Review before connecting
          </h2>
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
              className="btn btn-primary"
              {...held(!!busy, () => press("confirm", onConfirm))}
            >
              {busy === "confirm"
                ? "Connecting…"
                : "Confirm synthetic connection"}
            </button>
            <button
              type="button"
              className="btn"
              {...held(!!busy, () => press("cancel", onCancel))}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : items !== null && !connected ? (
        <button
          type="button"
          className="btn btn-primary"
          ref={startRef}
          {...held(!!busy, () => press("start", onStart))}
          data-testid="connector-start"
        >
          {busy === "start" ? "Preparing…" : "Connect synthetic library"}
        </button>
      ) : null}
    </section>
  );
}
