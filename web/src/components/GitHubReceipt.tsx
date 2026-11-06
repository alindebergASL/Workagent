import type { CSSProperties } from "react";
import { inertNotes, inertStream } from "@/lib/tool-activity";
import {
  EXCERPT_CHARS,
  type GitHubPagination,
  type GitHubReceipt as Receipt,
  type GitHubSnapshot,
} from "@/lib/github-receipt";

const WRAP: CSSProperties = { overflowWrap: "anywhere", minWidth: 0 };
const PRE: CSSProperties = {
  maxHeight: 240,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  maxWidth: "100%",
  margin: 0,
  fontSize: 12,
};

const SOURCE_LABEL = {
  live_public: "Live public GitHub API",
  fixture: "Deterministic fixture — not live GitHub",
} as const;

function scopeLine(s: GitHubSnapshot): string {
  if (s.discoveredCommit)
    return `Latest default-branch commit: ${s.discoveredCommit}`;
  if (s.resource === "readme") return `README at commit ${s.commit}`;
  if (s.number !== null)
    return `${s.resource === "issues" ? "Issue" : "Release"} #${s.number}`;
  return `${s.resource === "issues" ? "Issues" : "Releases"} page ${s.page}: ${s.itemCount} item${
    s.itemCount === 1 ? "" : "s"
  } shown (up to ${s.perPage} per page)`;
}

function pageLine(g: GitHubPagination | null): string {
  if (g === null) return "Whether more pages exist is not recorded.";
  if (g.limitReached)
    return "Page limit reached — later items can't be reached by this connector.";
  if (g.nextPage !== null)
    return `More exist — page ${g.nextPage} was not read.`;
  return g.hasMore
    ? "More may exist but no next page was offered."
    : "No further pages.";
}

/**
 * Compact view of one validated GitHub connector receipt. Public,
 * unauthenticated reads only; source text is inert and links are plain text.
 */
export function GitHubReceipt({
  receipt,
  context = "GitHub connector",
}: {
  receipt: Receipt;
  /** Names this call for assistive tech, e.g. "connectors.github.read, call 2". */
  context?: string;
}) {
  // The row label already shows a withheld/unverified headline; only the
  // reason is repeated here.
  if (receipt.kind !== "result")
    return (
      <div
        className="stack-sm"
        style={WRAP}
        data-testid="github-receipt"
        data-kind={receipt.kind}
      >
        <p className="small muted">{receipt.reason}</p>
      </div>
    );
  const s = receipt.snapshot;
  const excerpt = s ? inertStream(s.excerpt.slice(0, EXCERPT_CHARS)) : null;
  return (
    <div
      className="stack-sm"
      style={WRAP}
      data-testid="github-receipt"
      data-kind="result"
      data-status={receipt.status}
    >
      <p className="small">
        <strong>{receipt.headline}</strong>
        {s ? ` — ${s.repository}` : null}
      </p>
      {receipt.detail ? <p className="small">{receipt.detail}</p> : null}
      <p className="small muted">
        Public, unauthenticated{" "}
        {receipt.operation === "discover" ? "discovery" : "read"}.{" "}
        {receipt.source
          ? SOURCE_LABEL[receipt.source]
          : "Whether this came from live GitHub or a fixture is not recorded."}
      </p>
      {s ? (
        <>
          <p className="small">{scopeLine(s)}</p>
          {s.resource !== "readme" && s.number === null ? (
            <p className="small muted">
              Only this page was read; repository totals are not known.{" "}
              {pageLine(receipt.pagination)}
            </p>
          ) : null}
          {s.discoveredCommit ? (
            <p className="small muted">
              README not read yet — it needs a separate read pinned to this
              commit.
            </p>
          ) : null}
          <p className="small muted">
            Saved as source version {s.versionNumber} in Files.
          </p>
          <details className="ids-details">
            <summary className="small">
              Provenance<span className="sr-only">, {context}</span>
            </summary>
            <dl className="small muted" style={WRAP}>
              <dt>Requested</dt>
              <dd>{s.url}</dd>
              <dt>Observed</dt>
              <dd>{inertStream(s.fetchedAt).text}</dd>
              <dt>Response SHA-256</dt>
              <dd>{s.responseSha256}</dd>
              {s.etag ? (
                <>
                  <dt>ETag</dt>
                  <dd>{inertStream(s.etag).text}</dd>
                </>
              ) : null}
              {s.commit ? (
                <>
                  <dt>Commit</dt>
                  <dd>{s.commit}</dd>
                </>
              ) : null}
              {s.blobSha ? (
                <>
                  <dt>Blob</dt>
                  <dd>{s.blobSha}</dd>
                </>
              ) : null}
              <dt>Version basis</dt>
              <dd>
                {s.versionKind === "commit_and_blob"
                  ? "Exact commit and blob"
                  : "Retained response only (no commit pin)"}
              </dd>
              <dt>Snapshot</dt>
              <dd>{s.snapshotId}</dd>
            </dl>
          </details>
          {excerpt && excerpt.text !== "" ? (
            <details className="ids-details">
              <summary className="small">
                Source excerpt (untrusted text)
                <span className="sr-only">
                  , {context}, {s.repository}
                </span>
              </summary>
              {/* Scrollable, so keyboard reachable and named per call. */}
              <pre
                style={PRE}
                tabIndex={0}
                role="region"
                aria-label={`Source excerpt, ${context}, ${s.repository}`}
              >
                {excerpt.text}
              </pre>
              {s.excerpt.length > EXCERPT_CHARS || excerpt.clipped ? (
                <p className="small muted">
                  Excerpt clipped; the saved source holds more.
                </p>
              ) : null}
            </details>
          ) : null}
          {s.omissions.length > 0 ? (
            <p className="small muted">
              Not covered: {inertNotes(s.omissions)}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
