/**
 * connectors.github.discover / connectors.github.read receipts (native public
 * GitHub adapter, capabilities/github_adapters.py GitHubOutput v1). The
 * observation's `output` is an untyped record, so it is validated field by
 * field and copied into a frozen projection; the original is never reread.
 * Only `available` with a bound snapshot is presented as a read; every other
 * status says nothing was read, even though a receipt was recorded.
 */
import type { ToolAttemptView } from "./tool-activity";

export const GITHUB_IDS: Record<string, "github_discover" | "github_read"> = {
  "connectors.github.discover": "github_discover",
  "connectors.github.read": "github_read",
};
const STATUSES = [
  "available",
  "rate_limited",
  "unavailable",
  "not_found",
  "denied",
  "changed_source",
] as const;
export type GitHubStatus = (typeof STATUSES)[number];
// Optional forward field; GitHubResult does not record it yet (see handoff).
const SOURCES = ["live_public", "fixture"] as const;
export type GitHubSource = (typeof SOURCES)[number];

const HASH = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const SLUG = "[A-Za-z0-9][A-Za-z0-9_-]{0,38}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}";
// connectors/github_read.PATH under HOST, captured.
const URL_RE = new RegExp(
  `^https://api\\.github\\.com/repos/(${SLUG})/(?:(issues|releases)\\?(?:state=all&)?page=([1-5])&per_page=([1-9]|1[0-9]|20)|(commits)\\?per_page=1|readme\\?ref=([a-f0-9]{40})|(issues|releases)/([1-9][0-9]{0,9}))$`,
);
const EXTRACTOR = "github-public-read-v1";
const TEXT_MAX = 200000;
export const EXCERPT_CHARS = 2000;
const TITLE_CHARS = 300;
const MAX_ITEMS = 20;

export interface GitHubSnapshot {
  snapshotId: string;
  workspaceFileId: string;
  versionNumber: number;
  repository: string;
  resource: "readme" | "issues" | "releases";
  /** Discover pages only; the selected slice, never whole-repository totals. */
  page: number | null;
  perPage: number | null;
  number: number | null;
  itemCount: number;
  /** github_discover readme: latest default-branch commit, not a README pin. */
  discoveredCommit: string | null;
  url: string;
  fetchedAt: string;
  responseSha256: string;
  textSha256: string;
  etag: string | null;
  commit: string | null;
  blobSha: string | null;
  versionKind: "commit_and_blob" | "retained_response";
  omissions: string[];
  /** Inert, untrusted source text for optional display. */
  excerpt: string;
}

export interface GitHubPagination {
  page: number;
  perPage: number;
  itemCount: number;
  nextPage: number | null;
  hasMore: boolean;
  limitReached: boolean;
}

export type GitHubReceipt =
  | { kind: "unverified"; headline: string; reason: string }
  | { kind: "withheld"; headline: string; reason: string }
  | {
      kind: "result";
      /** Status is available; says nothing about live vs fixture (see source). */
      ok: boolean;
      headline: string;
      detail: string | null;
      operation: "discover" | "read";
      status: GitHubStatus;
      source: GitHubSource | null;
      retryAfterSeconds: number | null;
      resetEpochSeconds: number | null;
      snapshot: GitHubSnapshot | null;
      pagination: GitHubPagination | null;
    };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 4096): v is string =>
  typeof v === "string" && v.length <= max;
const nat = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const optNat = (v: unknown, max: number) =>
  v === undefined || v === null || nat(v, max);
const onlyKeys = (r: Rec, allowed: string[]) =>
  Object.keys(r).every((k) => allowed.includes(k));

class Malformed extends Error {}
function need<T>(v: T | null | false | undefined, what: string): T {
  if (v === null || v === false || v === undefined) throw new Malformed(what);
  return v;
}

export function isGitHubAttempt(attempt: ToolAttemptView): boolean {
  return attempt.capability_id in GITHUB_IDS;
}

const HEADLINES: Record<GitHubStatus, string> = {
  // An available read is headlined by its recorded source; see AVAILABLE.
  available: "Public GitHub source read",
  changed_source:
    "Source changed from the expected version — current copy retained, not the one expected",
  rate_limited: "GitHub rate limit reached — nothing was read",
  unavailable: "GitHub unavailable — nothing was read",
  not_found: "Not found or not public — nothing was read",
  denied: "Refused — nothing was read",
};

/** Only a recorded live_public source may claim a public GitHub read. */
const AVAILABLE: Record<GitHubSource | "unrecorded", string> = {
  live_public: "Public GitHub source read",
  fixture: "Fixture read — not live GitHub",
  unrecorded: "Source read (live or fixture not recorded)",
};

function parseSnapshot(
  v: unknown,
  ws: string,
  attempt: ToolAttemptView,
  kind: "github_discover" | "github_read",
): GitHubSnapshot {
  need(isRec(v), "snapshot");
  const s = v as Rec;
  for (const k of ["snapshot_id", "workspace_file_id", "conversation_id"])
    need(str(s[k]) && ID.test(s[k] as string), `snapshot ${k}`);
  // Read authority: a snapshot for another workspace/run/attempt is refused.
  need(s.workspace_id === ws, "snapshot workspace");
  need(
    nat(s.version_number) && (s.version_number as number) >= 1,
    "snapshot version",
  );
  need(s.trust_label === "untrusted_evidence", "trust label");
  const l = need(isRec(s.locator) && s.locator, "locator");
  need(l.kind === "public_source", "locator kind");
  need(l.run_id === attempt.run_id, "locator run");
  need(l.tool_attempt_id === attempt.attempt_id, "locator attempt");
  need(l.extractor_version === EXTRACTOR, "extractor version");
  need(l.browser_used === false && l.status_code === 200, "fetch");
  need(Array.isArray(l.redirects) && l.redirects.length === 0, "redirects");
  need(str(l.sha256) && HASH.test(l.sha256), "response hash");
  need(s.original_sha256 === l.sha256, "snapshot response hash");
  need(str(l.text_sha256) && HASH.test(l.text_sha256), "text hash");
  need(s.extraction_sha256 === l.text_sha256, "snapshot extraction hash");
  need(str(l.fetched_at, 64), "fetched at");
  need(str(l.url, 2048) && l.final_url === l.url, "url");
  const m = need(URL_RE.exec(l.url as string), "url shape");
  const ev = need(
    isRec(l.external_version) && l.external_version,
    "external version",
  );
  need(ev.etag === null || str(ev.etag, 512), "etag");
  need(str(l.text, TEXT_MAX), "text");
  const omissions = [
    ...need(Array.isArray(s.omissions) && s.omissions, "omissions"),
    ...need(
      isRec(l.coverage) &&
        Array.isArray(l.coverage.omissions) &&
        l.coverage.omissions,
      "coverage",
    ),
  ];
  need(
    omissions.length <= 60 && omissions.every((o) => str(o, 2000)),
    "omissions",
  );

  const repository = m[1]!;
  const commitDiscovery = m[5] !== undefined;
  const resource = (m[2] ??
    (commitDiscovery || m[6] ? "readme" : m[7])) as GitHubSnapshot["resource"];
  const page = m[3] ? Number(m[3]) : null;
  const perPage = m[4] ? Number(m[4]) : null;
  const number = m[8] ? Number(m[8]) : null;
  const urlCommit = m[6] ?? null;
  // A discover call reads a listing or the latest commit (never a README
  // body); a read names one item or a README at an exact commit.
  if (kind === "github_discover")
    need(number === null && urlCommit === null, "discover url");
  else
    need(
      page === null &&
        !commitDiscovery &&
        (resource === "readme" ? urlCommit : number) !== null,
      "read url",
    );

  let doc: unknown;
  try {
    doc = JSON.parse(l.text as string);
  } catch {
    throw new Malformed("extraction");
  }
  need(isRec(doc) && onlyKeys(doc, ["provenance", "evidence"]), "extraction");
  const p = need(
    isRec((doc as Rec).provenance) && ((doc as Rec).provenance as Rec),
    "provenance",
  );
  need(
    p.repository === repository && p.resource === resource,
    "provenance resource",
  );
  need(
    onlyKeys(p, [
      "repository",
      "resource",
      "response_sha256",
      "observed_at",
      "etag",
      "commit",
      "blob_sha",
      "source_updated_at",
      "version_kind",
    ]),
    "provenance fields",
  );
  need(
    p.source_updated_at == null || str(p.source_updated_at, 64),
    "source updated at",
  );
  need(p.response_sha256 === l.sha256, "provenance hash");
  need(p.etag === ev.etag, "provenance etag");
  need(p.commit === urlCommit, "provenance commit");
  need(
    p.blob_sha === null || (str(p.blob_sha) && SHA1.test(p.blob_sha)),
    "blob sha",
  );
  need(
    p.version_kind === (urlCommit ? "commit_and_blob" : "retained_response"),
    "version kind",
  );
  const e = (doc as Rec).evidence;
  let itemCount: number;
  let excerpt: string;
  let discoveredCommit: string | null = null;
  if (commitDiscovery) {
    // Discovery only names a commit; the README needs a separate pinned read.
    need(p.blob_sha === null, "blob sha");
    need(
      isRec(e) &&
        onlyKeys(e, ["commit", "notice", "message", "committed_at"]) &&
        str(e.commit) &&
        SHA1.test(e.commit) &&
        (e.notice === undefined || str(e.notice, 500)) &&
        (e.message === undefined || str(e.message, 20000)) &&
        (e.committed_at === undefined || str(e.committed_at, 64)),
      "commit discovery",
    );
    discoveredCommit = (e as Rec).commit as string;
    itemCount = 1;
    excerpt = str((e as Rec).message) ? ((e as Rec).message as string) : "";
  } else if (resource === "readme") {
    need(
      isRec(e) && str(e.text, TEXT_MAX) && e.blob_sha === p.blob_sha,
      "readme",
    );
    need(p.blob_sha !== null, "readme blob");
    itemCount = 1;
    excerpt = (e as Rec).text as string;
  } else {
    need(p.blob_sha === null, "blob sha");
    const rows = need(
      Array.isArray(e) &&
        e.length <= (perPage ?? 1) &&
        e.length <= MAX_ITEMS &&
        e,
      "items",
    );
    if (kind === "github_read") need(rows.length === 1, "single item");
    itemCount = rows.length;
    excerpt = rows
      .map((r) => {
        need(isRec(r), "item");
        const x = r as Rec;
        const label = [x.title, x.name, x.tag_name].find((t) => str(t)) as
          string | undefined;
        const n = nat(x.number) ? `#${x.number} ` : "";
        const state = str(x.state, 40) ? ` (${x.state})` : "";
        return `${n}${(label ?? "(untitled)").slice(0, TITLE_CHARS)}${state}`;
      })
      .join("\n");
  }
  return Object.freeze({
    snapshotId: s.snapshot_id as string,
    workspaceFileId: s.workspace_file_id as string,
    versionNumber: s.version_number as number,
    repository,
    resource,
    page,
    perPage,
    number,
    itemCount,
    discoveredCommit,
    url: l.url as string,
    fetchedAt: l.fetched_at as string,
    responseSha256: l.sha256 as string,
    textSha256: l.text_sha256 as string,
    etag: ev.etag as string | null,
    commit: urlCommit,
    blobSha: p.blob_sha as string | null,
    versionKind: p.version_kind as GitHubSnapshot["versionKind"],
    omissions: Object.freeze([...(omissions as string[])]) as string[],
    excerpt: excerpt.slice(0, EXCERPT_CHARS + 1),
  });
}

const PAGINATION_KEYS = [
  "page",
  "per_page",
  "item_count",
  "next_page",
  "has_more",
  "limit_reached",
];
/**
 * GitHubResult.pagination: only for a retained listing page, and it must
 * describe exactly that page. Null/absent is allowed (single item, commit
 * discovery, or not recorded).
 */
function parsePagination(
  v: unknown,
  snap: GitHubSnapshot | null,
): GitHubPagination | null {
  if (v === undefined || v === null) return null;
  need(isRec(v), "pagination");
  const g = v as Rec;
  need(
    Object.keys(g).length === PAGINATION_KEYS.length &&
      onlyKeys(g, PAGINATION_KEYS),
    "pagination fields",
  );
  need(nat(g.page, 5) && g.page >= 1, "pagination page");
  need(nat(g.per_page, 20) && g.per_page >= 1, "pagination per page");
  need(nat(g.item_count, 20), "pagination item count");
  need(
    g.next_page === null || (nat(g.next_page, 5) && g.next_page >= 1),
    "pagination next page",
  );
  need(
    typeof g.has_more === "boolean" && typeof g.limit_reached === "boolean",
    "pagination flags",
  );
  need(
    snap !== null &&
      snap.page === g.page &&
      snap.perPage === g.per_page &&
      snap.itemCount === g.item_count,
    "pagination binding",
  );
  need((g.item_count as number) <= (g.per_page as number), "pagination count");
  // A next page is only offered when more exist and it is the following page.
  need(
    g.next_page === null ||
      (g.has_more === true &&
        g.limit_reached === false &&
        g.next_page === (g.page as number) + 1),
    "pagination next",
  );
  need(!g.limit_reached || g.next_page === null, "pagination limit");
  return Object.freeze({
    page: g.page as number,
    perPage: g.per_page as number,
    itemCount: g.item_count as number,
    nextPage: g.next_page as number | null,
    hasMore: g.has_more as boolean,
    limitReached: g.limit_reached as boolean,
  });
}

/**
 * Validated, frozen projection of a GitHub connector attempt. `ws` is the
 * workspace the attempts were read under; snapshots outside it are refused.
 */
export function githubReceipt(
  attempt: ToolAttemptView,
  ws: string,
): GitHubReceipt {
  const o = attempt.observation;
  if (attempt.state !== "observed" || o?.status !== "observed")
    return Object.freeze({
      kind: "withheld",
      headline: "No GitHub result",
      reason:
        attempt.state === "outcome_unknown"
          ? "The outcome could not be confirmed; nothing is shown."
          : attempt.state === "failed" || attempt.state === "cost_only"
            ? "The call ended without a kept result receipt."
            : "No result receipt has been recorded yet.",
    });
  const unverified = (reason: string): GitHubReceipt =>
    Object.freeze({
      kind: "unverified",
      headline: "Receipt recorded — result unverified",
      reason,
    });
  const capability = GITHUB_IDS[attempt.capability_id];
  if (
    !capability ||
    o.schema_version !== "tool-observation/v1" ||
    o.capability_id !== attempt.capability_id ||
    o.attempt_id !== attempt.attempt_id ||
    o.call_id !== attempt.call_id ||
    o.run_id !== attempt.run_id
  )
    return unverified(
      "The recorded observation does not match this tool call, so its result is not shown.",
    );
  const out = o.output;
  if (
    !isRec(out) ||
    !onlyKeys(out, ["capability", "version", "result"]) ||
    out.capability !== capability ||
    out.version !== "1"
  )
    return unverified(
      "The recorded result is not a recognised GitHub receipt.",
    );
  const r = out.result;
  try {
    need(isRec(r), "result");
    const x = r as Rec;
    need(
      onlyKeys(x, [
        "status",
        "snapshot",
        "retry_after_seconds",
        "reset_epoch_seconds",
        "source",
        "pagination",
      ]),
      "result fields",
    );
    need(STATUSES.includes(x.status as never), "status");
    need(optNat(x.retry_after_seconds, 86400), "retry after");
    need(optNat(x.reset_epoch_seconds, 4102444800), "reset");
    need(
      x.source === undefined ||
        x.source === null ||
        SOURCES.includes(x.source as never),
      "source",
    );
    const status = x.status as GitHubStatus;
    const hasSnapshot = x.snapshot !== undefined && x.snapshot !== null;
    // Only a read that captured (or re-captured) a source carries a snapshot.
    const readish = status === "available" || status === "changed_source";
    need(readish === hasSnapshot, "snapshot presence");
    if (status !== "rate_limited")
      need(
        x.retry_after_seconds == null && x.reset_epoch_seconds == null,
        "rate limit fields",
      );
    const snapshot = hasSnapshot
      ? parseSnapshot(x.snapshot, ws, attempt, capability)
      : null;
    const pagination = parsePagination(x.pagination, snapshot);
    const retry = (x.retry_after_seconds as number | null | undefined) ?? null;
    const reset = (x.reset_epoch_seconds as number | null | undefined) ?? null;
    const detail =
      status === "rate_limited"
        ? retry !== null
          ? `GitHub asked to wait ${retry}s before retrying.`
          : reset !== null
            ? `GitHub's limit resets at ${new Date(reset * 1000).toISOString()}.`
            : "GitHub gave no reset time."
        : status === "changed_source"
          ? "The fetched response hash differs from the version this call expected."
          : null;
    const source = (x.source as GitHubSource | null | undefined) ?? null;
    return Object.freeze({
      kind: "result",
      ok: status === "available",
      headline:
        status === "available"
          ? AVAILABLE[source ?? "unrecorded"]
          : HEADLINES[status],
      detail,
      operation: capability === "github_discover" ? "discover" : "read",
      status,
      source,
      retryAfterSeconds: retry,
      resetEpochSeconds: reset,
      snapshot,
      pagination,
    });
  } catch (e) {
    if (e instanceof Malformed)
      return unverified(
        `The recorded result failed validation (${e.message}).`,
      );
    throw e;
  }
}
