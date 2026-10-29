"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { ApiError, describeError } from "@/lib/contract/errors";
import {
  checkQuote,
  coverageNotes,
  extractionLabel,
  publicEvidence,
  RELATION_LABEL,
  safeHttpsHref,
  SEMANTIC_LABEL,
  shortHash,
  type ArtifactClaims,
  type ClaimFreshness,
  type QuoteRef,
  type SourceSnapshot,
} from "@/lib/research-contract";
import {
  getArtifactClaims,
  getResearchSnapshot,
  listResearchSnapshots,
} from "@/lib/client/research";
import {
  createCitationsReader,
  createSourcesReader,
  isDenial,
  type CitationsReader,
  type SourcesReader,
} from "@/lib/research-readers";

/**
 * Captured public pages and the exact quotes saved work cites from them.
 * Everything from a page is untrusted external data, shown as inert text.
 * Exact quotes verify attribution, not claim truth: there are no confidence
 * badges and nothing here accepts, rewrites or rebases a person's work when a
 * source changes — a newer capture only suggests a review.
 */

function errText(e: unknown): string {
  if (isDenial(e))
    return "These sources aren’t available to you now. Access may have changed.";
  if (e instanceof ApiError && e.status === 0 && e.code === "validation_error")
    return e.message;
  const d = describeError(e);
  return `${d.title}. ${d.nextAction}`;
}

function When({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <time dateTime={iso} title={iso}>
      {Number.isNaN(d.getTime()) ? iso : d.toLocaleString()}
    </time>
  );
}

/** A URL as text; a browser link only when it is plain https. */
export function SourceUrl({ url, label }: { url: string; label?: string }) {
  const href = safeHttpsHref(url);
  return (
    <span className="research-url" style={{ overflowWrap: "anywhere" }}>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow">
          {label ?? url}
        </a>
      ) : (
        <>
          {label ?? url}{" "}
          <span className="small muted">
            (not a secure https link; not opened)
          </span>
        </>
      )}
    </span>
  );
}

/** Exact capture metadata for one snapshot. Machinery stays under Details. */
export function SnapshotDetails({
  snapshot,
  heading,
}: {
  snapshot: SourceSnapshot;
  heading?: string;
}) {
  const ev = publicEvidence(snapshot);
  if (!ev)
    return (
      <div className="stack-xs" data-snapshot={snapshot.snapshot_id}>
        <p className="small">
          {heading ? <strong>{heading}: </strong> : null}
          Not a public web capture ({snapshot.locator.kind}). Snapshot{" "}
          <code>{snapshot.snapshot_id}</code> · original{" "}
          <code title={snapshot.original_sha256}>
            {shortHash(snapshot.original_sha256)}
          </code>
        </p>
      </div>
    );
  const notes = coverageNotes(ev);
  return (
    <div
      className="research-snapshot stack-xs"
      data-snapshot={snapshot.snapshot_id}
    >
      <p className="small" style={{ overflowWrap: "anywhere" }}>
        {heading ? <strong>{heading}: </strong> : null}
        <span data-testid="snapshot-title">
          {ev.title?.trim() ? ev.title : "Untitled page"}
        </span>{" "}
        · captured <When iso={ev.fetched_at} />
      </p>
      <p className="small">
        <SourceUrl url={ev.final_url} />
      </p>
      <p className="small muted" data-testid="untrusted-label">
        External page content — untrusted; shown as plain text.
      </p>
      {notes.length > 0 ? (
        <ul className="small research-coverage" data-testid="coverage-notes">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : (
        <p className="small muted" data-testid="coverage-complete">
          Body and text captured completely.
        </p>
      )}
      <details>
        <summary className="small">Capture details</summary>
        <dl
          className="small research-meta"
          style={{ overflowWrap: "anywhere" }}
        >
          <dt>Snapshot</dt>
          <dd>
            <code>{snapshot.snapshot_id}</code> (version{" "}
            {snapshot.version_number}
            {snapshot.parent_snapshot_id ? (
              <>
                , follows <code>{snapshot.parent_snapshot_id}</code>
              </>
            ) : null}
            )
          </dd>
          <dt>Requested URL</dt>
          <dd>
            <SourceUrl url={ev.url} />
          </dd>
          <dt>Final URL · HTTP status</dt>
          <dd>
            {ev.final_url} · {ev.status_code}
          </dd>
          <dt>Redirects</dt>
          <dd>
            {ev.redirects.length === 0 ? (
              "None"
            ) : (
              <ol>
                {ev.redirects.map((r, i) => (
                  <li key={i}>
                    {r.status} {r.url} → {r.location}
                  </li>
                ))}
              </ol>
            )}
          </dd>
          <dt>Server version</dt>
          <dd>
            ETag {ev.external_version.etag ?? "not given"} · Last-Modified{" "}
            {ev.external_version.last_modified ?? "not given"}
          </dd>
          <dt>Original bytes</dt>
          <dd>
            {ev.mime_type} · blob <code>{ev.blob_id}</code> · SHA-256{" "}
            <code>{ev.sha256}</code>
          </dd>
          <dt>Extracted text</dt>
          <dd>
            {extractionLabel(ev.extraction_status)} ·{" "}
            {Array.from(ev.text).length.toLocaleString()} characters · SHA-256{" "}
            <code>{ev.text_sha256}</code>
          </dd>
          <dt>Extractor</dt>
          <dd>
            {ev.extractor_version}
            {ev.browser_used ? " · offline browser" : " · raw retrieval"}
          </dd>
          <dt>Captured by</dt>
          <dd>
            run <code>{ev.run_id}</code> · tool attempt{" "}
            <code>{ev.tool_attempt_id}</code>
          </dd>
        </dl>
      </details>
      <details>
        <summary className="small">Captured text</summary>
        {ev.text.length === 0 ? (
          <p className="small muted">No text was captured.</p>
        ) : (
          <pre
            className="small research-text"
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              maxHeight: "50vh",
              overflow: "auto",
            }}
          >
            {ev.text}
          </pre>
        )}
      </details>
    </div>
  );
}

/** Captured public sources of this conversation, paginated, none omitted. */
export function ResearchSources({
  ws,
  cid,
  reader: injected,
}: {
  ws: string;
  cid: string;
  /** Tests inject a reader over a controlled transport. */
  reader?: SourcesReader;
}) {
  const reader = useMemo(
    () =>
      injected ??
      createSourcesReader({
        fetchPage: (after, signal) =>
          listResearchSnapshots(ws, cid, after, signal),
      }),
    [injected, ws, cid],
  );
  useEffect(() => {
    if (!injected) reader.refresh();
    return () => reader.dispose();
  }, [reader, injected]);
  const st = useSyncExternalStore(
    reader.subscribe,
    reader.getSnapshot,
    reader.getSnapshot,
  );
  return (
    <ResearchSourceList
      items={st.items}
      error={st.phase === "failed" ? errText(st.error) : null}
      hasMore={st.nextAfter !== null}
      busy={st.loadingMore}
      checking={st.phase === "checking"}
      onMore={reader.more}
      onRefresh={reader.refresh}
    />
  );
}

/** Read-only refresh: re-reads what the service holds; never a web fetch. */
function RefreshButton({
  label,
  checking,
  onRefresh,
}: {
  label: string;
  checking: boolean;
  onRefresh: () => void;
}) {
  return (
    <span className="small muted">
      <button
        type="button"
        className="btn btn-sm btn-quiet"
        disabled={checking}
        onClick={onRefresh}
        data-testid="research-refresh"
      >
        {checking ? "Checking…" : label}
      </button>{" "}
      Re-reads saved records; nothing new is fetched from the web.
    </span>
  );
}

export function ResearchSourceList({
  items,
  error,
  hasMore,
  busy = false,
  checking = false,
  onMore,
  onRefresh,
}: {
  items: SourceSnapshot[] | null;
  error: string | null;
  hasMore: boolean;
  busy?: boolean;
  checking?: boolean;
  onMore?: () => void;
  onRefresh?: () => void;
}) {
  const shown = error ? null : items;
  if (!onRefresh && !error && shown && shown.length === 0) return null;
  return (
    <div className="stack-sm research-sources" data-testid="research-sources">
      <h3 className="small">Captured web sources</h3>
      {onRefresh ? (
        <RefreshButton
          label="Refresh sources"
          checking={checking}
          onRefresh={onRefresh}
        />
      ) : null}
      {error ? (
        <p className="hint" role="alert">
          {error}
        </p>
      ) : null}
      {shown && shown.length === 0 ? (
        <p className="small muted" data-testid="no-sources">
          No captured web sources in this conversation.
        </p>
      ) : null}
      {shown && shown.length > 0 ? (
        <ul className="stack-sm" style={{ listStyle: "none", padding: 0 }}>
          {shown.map((s) => (
            <li key={s.snapshot_id}>
              <SnapshotDetails snapshot={s} />
            </li>
          ))}
        </ul>
      ) : null}
      {shown && hasMore ? (
        <p className="small">
          {shown.length} shown; more sources exist.{" "}
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            disabled={busy}
            onClick={onMore}
          >
            {busy ? "Loading…" : "Show more sources"}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/** One cited quote, checked against its exact capture on request. */
function EvidenceRow({
  ev,
  snapshot,
  onLoad,
  loadError,
}: {
  ev: QuoteRef;
  snapshot: SourceSnapshot | undefined;
  onLoad?: (id: string) => void;
  loadError?: string | null;
}) {
  const check = checkQuote(ev, snapshot);
  return (
    <li
      className="research-evidence stack-xs"
      data-relation={ev.relation}
      data-snapshot={ev.snapshot_id}
    >
      <p className="small">
        <strong>{RELATION_LABEL[ev.relation]}</strong>
      </p>
      <blockquote
        className="research-quote"
        style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}
      >
        {ev.quote}
      </blockquote>
      <p className="small muted" style={{ overflowWrap: "anywhere" }}>
        Characters {ev.start}–{ev.end} of snapshot <code>{ev.snapshot_id}</code>{" "}
        · text SHA-256{" "}
        <code title={ev.text_sha256}>{shortHash(ev.text_sha256)}</code>
      </p>
      {check.state === "matches" ? (
        <p
          className="small research-context"
          data-testid="quote-matches"
          style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}
        >
          Matches the capture exactly: …{check.before}
          <mark>{check.quote}</mark>
          {check.after}…
        </p>
      ) : check.state === "mismatch" ? (
        <p className="small hint" role="alert" data-testid="quote-mismatch">
          This quote does not match the cited capture at that range. Treat the
          citation as unverified.
        </p>
      ) : check.state === "different_capture" ? (
        <p className="small hint" data-testid="quote-different">
          The loaded capture is not the exact text this quote cites.
        </p>
      ) : onLoad ? (
        <button
          type="button"
          className="btn btn-sm btn-quiet"
          onClick={() => onLoad(ev.snapshot_id)}
        >
          Check against the capture
        </button>
      ) : null}
      {loadError ? (
        <p className="small hint" role="alert">
          {loadError}
        </p>
      ) : null}
      {snapshot ? (
        <details>
          <summary className="small">Cited capture</summary>
          <SnapshotDetails snapshot={snapshot} heading="Original capture" />
        </details>
      ) : null}
    </li>
  );
}

/** One claim with its exact quotes, freshness and claimed relationships. */
export function ClaimView({
  item,
  snapshots,
  loadErrors = {},
  onLoad,
}: {
  item: ClaimFreshness;
  snapshots: Record<string, SourceSnapshot | undefined>;
  loadErrors?: Record<string, string | undefined>;
  onLoad?: (id: string) => void;
}) {
  const { claim } = item;
  const supports = claim.evidence.filter((e) => e.relation === "supports");
  const contradicts = claim.evidence.filter(
    (e) => e.relation === "contradicts",
  );
  const context = claim.evidence.filter((e) => e.relation === "context");
  const groups: [string, QuoteRef[]][] =
    claim.semantic_status === "conflict"
      ? [
          ["Supporting", supports],
          ["Contradicting", contradicts],
          ["Context", context],
        ]
      : [["", claim.evidence]];
  const stale = item.freshness === "potentially_stale";
  return (
    <article
      className="research-claim stack-xs"
      data-claim={claim.claim_id}
      data-freshness={item.freshness}
      data-semantic={claim.semantic_status}
    >
      <p style={{ overflowWrap: "anywhere" }}>{claim.claim}</p>
      <p className="small row wrap" style={{ gap: 6 }}>
        <span className={"chip chip-static"} data-testid="freshness-badge">
          {stale ? "Source may have changed" : "Sources current"}
        </span>
        <span className="muted" data-testid="semantic-label">
          {SEMANTIC_LABEL[claim.semantic_status]}
        </span>
      </p>
      {stale ? (
        <div className="stack-xs" role="status" data-testid="stale-warning">
          <p className="small">
            A newer capture of a cited source exists. Review it before relying
            on this claim. Your saved work and this citation have not been
            changed, and the original capture stays available below.
          </p>
          <ul className="small" style={{ listStyle: "none", padding: 0 }}>
            {item.newer_snapshot_ids.map((id) => (
              <li key={id} className="stack-xs">
                Newer capture <code>{id}</code>{" "}
                {snapshots[id] ? null : onLoad ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    onClick={() => onLoad(id)}
                  >
                    Show newer capture
                  </button>
                ) : null}
                {loadErrors[id] ? (
                  <span className="hint" role="alert">
                    {" "}
                    {loadErrors[id]}
                  </span>
                ) : null}
                {snapshots[id] ? (
                  <SnapshotDetails
                    snapshot={snapshots[id]!}
                    heading="Newer capture"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {item.coverage.some((c) => c !== "extracted") ? (
        <p className="small hint" data-testid="claim-coverage">
          Some cited captures are incomplete:{" "}
          {Array.from(new Set(item.coverage.filter((c) => c !== "extracted")))
            .map((c) => extractionLabel(c).toLowerCase())
            .join("; ")}
          .
        </p>
      ) : null}
      {claim.evidence.length === 0 ? (
        <p className="small muted" data-testid="no-evidence">
          No quote is attached to this claim.
        </p>
      ) : (
        groups.map(([label, rows]) =>
          rows.length === 0 && !label ? null : (
            <div key={label || "all"} className="stack-xs">
              {label ? (
                <p className="small">
                  <strong>{label}</strong>
                  {rows.length === 0 ? " — none recorded" : null}
                </p>
              ) : null}
              <ul
                className="stack-xs"
                style={{ listStyle: "none", padding: 0 }}
              >
                {rows.map((ev, i) => (
                  <EvidenceRow
                    key={`${ev.snapshot_id}:${ev.start}:${ev.end}:${i}`}
                    ev={ev}
                    snapshot={snapshots[ev.snapshot_id]}
                    loadError={loadErrors[ev.snapshot_id]}
                    onLoad={onLoad}
                  />
                ))}
              </ul>
            </div>
          ),
        )
      )}
      <details>
        <summary className="small">Claim record</summary>
        <p className="small muted" style={{ overflowWrap: "anywhere" }}>
          Claim <code>{claim.claim_id}</code> · revision{" "}
          <code>{claim.revision_id}</code> · body <code>{claim.body_hash}</code>{" "}
          · run <code>{claim.run_id}</code> · tool attempt{" "}
          <code>{claim.tool_attempt_id}</code> · recorded{" "}
          <When iso={claim.created_at} />
        </p>
      </details>
    </article>
  );
}

export function ClaimsList({
  claims,
  error,
  snapshots,
  loadErrors,
  onLoad,
  checking = false,
  onRefresh,
}: {
  claims: ArtifactClaims | null;
  error: string | null;
  snapshots: Record<string, SourceSnapshot | undefined>;
  loadErrors?: Record<string, string | undefined>;
  onLoad?: (id: string) => void;
  checking?: boolean;
  onRefresh?: () => void;
}) {
  const refresh = onRefresh ? (
    <RefreshButton
      label="Refresh citations"
      checking={checking}
      onRefresh={onRefresh}
    />
  ) : null;
  if (error)
    return (
      <div className="stack-xs research-claims">
        <p className="small hint" role="alert" data-testid="claims-error">
          {error}
        </p>
        {refresh}
      </div>
    );
  if (!claims || claims.items.length === 0)
    return refresh ? (
      <p className="research-claims" data-testid="claims-empty">
        {refresh}
      </p>
    ) : null;
  const stale = claims.items.filter(
    (i) => i.freshness === "potentially_stale",
  ).length;
  return (
    <details className="research-claims" data-testid="research-claims">
      <summary className="small">
        Sources for this version · {claims.items.length} cited claim
        {claims.items.length === 1 ? "" : "s"}
        {stale > 0 ? (
          <span className="chip chip-static" data-testid="claims-stale-badge">
            {" "}
            {stale} may be out of date
          </span>
        ) : null}
      </summary>
      {refresh}
      <p className="small muted">{claims.semantic_notice}</p>
      {claims.items.map((item) => (
        <ClaimView
          key={item.claim.claim_id}
          item={item}
          snapshots={snapshots}
          loadErrors={loadErrors}
          onLoad={onLoad}
        />
      ))}
    </details>
  );
}

/**
 * Citations bound to one exact saved revision and body hash. Changing the
 * revision, body or workspace discards everything shown for the old one;
 * a failed or refused read (401/403 and the canonical 404) clears every
 * claim, quote and capture, and no older pending read can bring them back.
 * Refreshing re-reads the records for this same revision; it never changes
 * the saved work.
 */
export function ArtifactCitations({
  ws,
  artifactId,
  revisionId,
  bodyHash,
  reader: injected,
}: {
  ws: string;
  artifactId: string;
  revisionId: string;
  bodyHash: string;
  /** Tests inject a reader over a controlled transport. */
  reader?: CitationsReader;
}) {
  const reader = useMemo(
    () =>
      injected ??
      createCitationsReader({
        binding: { artifactId, revisionId, bodyHash },
        fetchClaims: (signal) =>
          getArtifactClaims(ws, artifactId, revisionId, bodyHash, signal),
        fetchSnapshot: (id, signal) => getResearchSnapshot(ws, id, signal),
      }),
    [injected, ws, artifactId, revisionId, bodyHash],
  );
  useEffect(() => {
    if (!injected) reader.refresh();
    return () => reader.dispose();
  }, [reader, injected]);
  const st = useSyncExternalStore(
    reader.subscribe,
    reader.getSnapshot,
    reader.getSnapshot,
  );
  return (
    <ClaimsList
      claims={st.claims}
      error={st.phase === "failed" ? errText(st.error) : null}
      snapshots={st.snapshots}
      loadErrors={st.loadErrors}
      onLoad={reader.loadSnapshot}
      checking={st.phase === "checking"}
      onRefresh={reader.refresh}
    />
  );
}
