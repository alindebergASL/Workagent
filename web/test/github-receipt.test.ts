import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { githubReceipt } from "@/lib/github-receipt";
import { toolAttemptRow, type ToolAttemptView } from "@/lib/tool-activity";
import { GitHubReceipt } from "@/components/GitHubReceipt";

const H = (c: string) => c.repeat(64);
const WS = "ws1";
const COMMIT = "a".repeat(40);
const BLOB = "b".repeat(40);

const issuesText = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    provenance: {
      repository: "octo/demo",
      resource: "issues",
      response_sha256: H("1"),
      observed_at: "2026-10-28T10:00:00Z",
      etag: 'W/"abc"',
      commit: null,
      blob_sha: null,
      version_kind: "retained_response",
      ...over,
    },
    evidence: [
      {
        id: 1,
        number: 7,
        title: "<script>alert(1)</script> crash",
        state: "open",
      },
      { id: 2, number: 8, title: "docs", state: "closed" },
    ],
  });

const snapshot = (
  locator: Record<string, unknown> = {},
  over: Record<string, unknown> = {},
) => ({
  snapshot_id: "s1",
  workspace_file_id: "wf1",
  workspace_id: WS,
  conversation_id: "c1",
  version_number: 2,
  parent_snapshot_id: null,
  locator: {
    kind: "public_source",
    blob_id: "bl1",
    sha256: H("1"),
    mime_type: "application/json",
    title: "GitHub octo/demo issues",
    url: "https://api.github.com/repos/octo/demo/issues?state=all&page=2&per_page=10",
    final_url:
      "https://api.github.com/repos/octo/demo/issues?state=all&page=2&per_page=10",
    status_code: 200,
    redirects: [],
    fetched_at: "2026-10-28T10:00:00Z",
    extractor_version: "github-public-read-v1",
    coverage: { body_complete: true, text_complete: true, omissions: [] },
    external_version: { etag: 'W/"abc"', last_modified: null },
    extraction_status: "extracted",
    browser_used: false,
    text: issuesText(),
    text_sha256: H("2"),
    run_id: "r1",
    tool_attempt_id: "a1",
    ...locator,
  },
  observed_at: "2026-10-28T10:00:00Z",
  version_at: null,
  original_sha256: H("1"),
  extraction_sha256: H("2"),
  original_byte_length: 10,
  extraction_byte_length: 10,
  parser_version: "github-public-read-v1",
  extraction_status: "extracted",
  coverage: null,
  omissions: [],
  trust_label: "untrusted_evidence",
  ...over,
});

const attempt = (
  result: unknown,
  over: Partial<ToolAttemptView> = {},
  cap = "connectors.github.discover",
  outCap = "github_discover",
): ToolAttemptView =>
  ({
    attempt_id: "a1",
    call_id: "k1",
    capability_id: cap,
    run_id: "r1",
    state: "observed",
    observation: {
      schema_version: "tool-observation/v1",
      attempt_id: "a1",
      call_id: "k1",
      capability_id: cap,
      run_id: "r1",
      status: "observed",
      output: { capability: outCap, version: "1", result },
      input_refs: [],
      source_refs: [],
      output_refs: [],
      omissions: [],
      truncated: false,
      error: null,
      cost: {
        reserved_cost_usd: "0",
        reserved_units: 1,
        unit: "call",
        observed_cost_usd: null,
        basis: "unknown",
      },
      started_at: "2026-10-28T10:00:00Z",
      ended_at: "2026-10-28T10:00:01Z",
    },
    ...over,
  }) as unknown as ToolAttemptView;

const html = (a: ToolAttemptView) =>
  renderToStaticMarkup(
    createElement(GitHubReceipt, { receipt: githubReceipt(a, WS) }),
  );

describe("GitHub receipt parser", () => {
  it("projects an available discover page with the selected slice only", () => {
    const r = githubReceipt(
      attempt({ status: "available", snapshot: snapshot() }),
      WS,
    );
    expect(r.kind).toBe("result");
    if (r.kind !== "result") return;
    expect(r.ok).toBe(true);
    expect(r.source).toBeNull();
    expect(r.snapshot).toMatchObject({
      repository: "octo/demo",
      resource: "issues",
      page: 2,
      perPage: 10,
      itemCount: 2,
      etag: 'W/"abc"',
      versionKind: "retained_response",
    });
    expect(Object.isFrozen(r)).toBe(true);
    // An unrecorded source is not presented as a live GitHub read.
    const row = toolAttemptRow(
      attempt({ status: "available", snapshot: snapshot() }),
      WS,
    );
    expect(row.tone).toBe("unknown");
    expect(row.stateLabel).toBe("Source read (live or fixture not recorded)");
  });

  it.each([
    ["live_public", "Public GitHub source read", "ok"],
    ["fixture", "Fixture read — not live GitHub", "unknown"],
    [null, "Source read (live or fixture not recorded)", "unknown"],
  ] as const)(
    "headlines an available read from %s truthfully",
    (src, h, tone) => {
      const a = attempt({
        status: "available",
        snapshot: snapshot(),
        source: src,
      });
      const r = githubReceipt(a, WS);
      expect(r.kind === "result" && r.headline).toBe(h);
      const row = toolAttemptRow(a, WS);
      expect(row.stateLabel).toBe(h);
      expect(row.tone).toBe(tone);
      if (src !== "live_public")
        expect(html(a)).not.toContain("Public GitHub source read");
    },
  );

  it("projects a commit-pinned README read with blob", () => {
    const text = JSON.stringify({
      provenance: {
        repository: "octo/demo",
        resource: "readme",
        response_sha256: H("1"),
        observed_at: "x",
        etag: null,
        commit: COMMIT,
        blob_sha: BLOB,
        version_kind: "commit_and_blob",
      },
      evidence: { name: "README.md", text: "# Hello\nworld", blob_sha: BLOB },
    });
    const url = `https://api.github.com/repos/octo/demo/readme?ref=${COMMIT}`;
    const a = attempt(
      {
        status: "available",
        snapshot: snapshot({
          url,
          final_url: url,
          text,
          external_version: { etag: null, last_modified: null },
        }),
      },
      {},
      "connectors.github.read",
      "github_read",
    );
    const r = githubReceipt(a, WS);
    expect(r.kind === "result" && r.snapshot).toMatchObject({
      commit: COMMIT,
      blobSha: BLOB,
      itemCount: 1,
    });
    expect(html(a)).toContain("README at commit " + COMMIT);
  });

  it.each(["rate_limited", "unavailable", "not_found", "denied"])(
    "%s never looks successful and carries no snapshot",
    (status) => {
      const a = attempt({
        status,
        snapshot: null,
        ...(status === "rate_limited" ? { retry_after_seconds: 60 } : {}),
      });
      const r = githubReceipt(a, WS);
      expect(r.kind === "result" && !r.ok && r.snapshot === null).toBe(true);
      const row = toolAttemptRow(a, WS);
      expect(row.tone).not.toBe("ok");
      expect(row.stateLabel).toMatch(/nothing was read/);
      expect(html(a)).not.toContain("Provenance");
    },
  );

  it("changed_source keeps the snapshot but is not ok", () => {
    const a = attempt({ status: "changed_source", snapshot: snapshot() });
    const r = githubReceipt(a, WS);
    expect(r.kind === "result" && !r.ok && r.snapshot !== null).toBe(true);
    expect(toolAttemptRow(a, WS).tone).toBe("unknown");
  });

  it.each<[string, ToolAttemptView]>([
    [
      "attempt mismatch",
      attempt(
        { status: "available", snapshot: snapshot() },
        { attempt_id: "zz" },
      ),
    ],
    [
      "output capability",
      attempt(
        { status: "available", snapshot: snapshot() },
        {},
        "connectors.github.discover",
        "github_read",
      ),
    ],
    [
      "other workspace",
      attempt({
        status: "available",
        snapshot: snapshot({}, { workspace_id: "ws2" }),
      }),
    ],
    [
      "other attempt",
      attempt({
        status: "available",
        snapshot: snapshot({ tool_attempt_id: "a9" }),
      }),
    ],
    [
      "foreign host",
      attempt({
        status: "available",
        snapshot: snapshot({
          url: "https://evil.example/repos/octo/demo/readme",
          final_url: "https://evil.example/repos/octo/demo/readme",
        }),
      }),
    ],
    [
      "hash drift",
      attempt({
        status: "available",
        snapshot: snapshot({ text: issuesText({ response_sha256: H("9") }) }),
      }),
    ],
    [
      "rate-limited with snapshot",
      attempt({ status: "rate_limited", snapshot: snapshot() }),
    ],
    [
      "available without snapshot",
      attempt({ status: "available", snapshot: null }),
    ],
    ["unknown status", attempt({ status: "ok", snapshot: null })],
    [
      "extra field",
      attempt({ status: "unavailable", snapshot: null, token: "x" }),
    ],
    [
      "bad json",
      attempt({ status: "available", snapshot: snapshot({ text: "{" }) }),
    ],
  ])("fails closed on %s", (_, a) => {
    const r = githubReceipt(a, WS);
    expect(r.kind).toBe("unverified");
    expect(toolAttemptRow(a, WS).tone).toBe("unknown");
    expect(html(a)).not.toContain("octo/demo");
  });

  it("withholds non-observed attempts", () => {
    const a = attempt(
      { status: "available", snapshot: snapshot() },
      { state: "outcome_unknown" },
    );
    expect(githubReceipt(a, WS).kind).toBe("withheld");
  });
});

describe("GitHub receipt DOM", () => {
  const a = attempt({
    status: "available",
    snapshot: snapshot(),
    source: "fixture",
  });
  const out = html(a);
  it("labels public mode, fixture source, slice and omissions", () => {
    expect(out).toContain("Public, unauthenticated discovery");
    expect(out).toContain("Deterministic fixture — not live GitHub");
    expect(out).toContain("Issues page 2: 2 items shown (up to 10 per page)");
    expect(out).toContain("repository totals are not known");
    expect(out).not.toMatch(/OAuth|private repo|sign in/i);
  });
  it("keeps source text inert and links as plain text", () => {
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("href=");
    expect(out).toContain("Source excerpt (untrusted text)");
  });
  it("makes the excerpt keyboard reachable and names repeated summaries", () => {
    const named = renderToStaticMarkup(
      createElement(GitHubReceipt, {
        receipt: githubReceipt(a, WS),
        context: "connectors.github.discover, call 3",
      }),
    );
    expect(named).toMatch(
      /<pre[^>]*tabindex="0"[^>]*role="region"[^>]*aria-label="Source excerpt, connectors.github.discover, call 3, octo\/demo"/,
    );
    expect(named).toContain(
      '<span class="sr-only">, connectors.github.discover, call 3</span>',
    );
  });
  it("does not repeat the row headline for withheld or unverified results", () => {
    for (const x of [
      attempt(
        { status: "available", snapshot: snapshot() },
        { state: "failed" },
      ),
      attempt({ status: "available", snapshot: snapshot(), source: "cache" }),
    ]) {
      const r = githubReceipt(x, WS);
      expect(r.kind).not.toBe("result");
      expect(html(x)).not.toContain(r.headline);
      expect(toolAttemptRow(x, WS).stateLabel).toBe(r.headline);
    }
  });
  it("says when live vs fixture is not recorded", () => {
    expect(
      html(attempt({ status: "available", snapshot: snapshot() })),
    ).toContain("not recorded");
  });
  it("wraps long hashes at narrow widths", () => {
    expect(out).toContain("overflow-wrap:anywhere");
    expect(out).toContain("min-width:0");
  });
});

describe("GitHub receipt alignment (commit discovery, pagination, hashes)", () => {
  const commitsUrl =
    "https://api.github.com/repos/octo/demo/commits?per_page=1";
  const discoveryText = (ev: Record<string, unknown> = {}) =>
    JSON.stringify({
      provenance: {
        repository: "octo/demo",
        resource: "readme",
        response_sha256: H("1"),
        observed_at: "2026-10-28T10:00:00Z",
        etag: 'W/"abc"',
        commit: null,
        blob_sha: null,
        source_updated_at: null,
        version_kind: "retained_response",
      },
      evidence: {
        commit: COMMIT,
        notice: "README availability and body require an exact commit read.",
        ...ev,
      },
    });
  const discovery = (
    ev: Record<string, unknown> = {},
    loc: Record<string, unknown> = {},
  ) =>
    attempt({
      status: "available",
      source: "live_public",
      snapshot: snapshot({
        url: commitsUrl,
        final_url: commitsUrl,
        text: discoveryText(ev),
        ...loc,
      }),
    });
  const page = (over: Record<string, unknown> = {}) => ({
    page: 2,
    per_page: 10,
    item_count: 2,
    next_page: 3,
    has_more: true,
    limit_reached: false,
    ...over,
  });

  it("shows the discovered commit for a separate pinned read", () => {
    const r = githubReceipt(discovery({ message: "fix: x" }), WS);
    expect(r.kind === "result" && r.ok).toBe(true);
    expect(r.kind === "result" && r.snapshot).toMatchObject({
      discoveredCommit: COMMIT,
      commit: null,
      blobSha: null,
      versionKind: "retained_response",
      excerpt: "fix: x",
    });
    const out = html(discovery());
    expect(out).toContain("Latest default-branch commit: " + COMMIT);
    expect(out).toContain("README not read yet");
    expect(out).toContain("Live public GitHub API");
    expect(out).not.toContain("README (default branch)");
  });

  it.each<[string, ToolAttemptView]>([
    [
      "old /readme discovery",
      attempt({
        status: "available",
        snapshot: snapshot({
          url: "https://api.github.com/repos/octo/demo/readme",
          final_url: "https://api.github.com/repos/octo/demo/readme",
        }),
      }),
    ],
    ["non-sha discovered commit", discovery({ commit: "main" })],
    ["extra evidence field", discovery({ body: "x" })],
    [
      "discovery blob",
      discovery(
        {},
        {
          text: discoveryText().replace(
            '"blob_sha":null',
            `"blob_sha":"${BLOB}"`,
          ),
        },
      ),
    ],
    [
      "commit discovery via read",
      attempt(
        {
          status: "available",
          snapshot: snapshot({
            url: commitsUrl,
            final_url: commitsUrl,
            text: discoveryText(),
          }),
        },
        {},
        "connectors.github.read",
        "github_read",
      ),
    ],
    [
      "extraction hash drift",
      attempt({
        status: "available",
        snapshot: snapshot({}, { extraction_sha256: H("7") }),
      }),
    ],
    [
      "extra provenance field",
      attempt({
        status: "available",
        snapshot: snapshot({ text: issuesText({ token: "x" }) }),
      }),
    ],
    [
      "unknown source",
      attempt({ status: "available", snapshot: snapshot(), source: "cache" }),
    ],
    [
      "pagination page mismatch",
      attempt({
        status: "available",
        snapshot: snapshot(),
        pagination: page({ page: 3, next_page: 4 }),
      }),
    ],
    [
      "pagination count mismatch",
      attempt({
        status: "available",
        snapshot: snapshot(),
        pagination: page({ item_count: 5 }),
      }),
    ],
    [
      "next without more",
      attempt({
        status: "available",
        snapshot: snapshot(),
        pagination: page({ has_more: false }),
      }),
    ],
    [
      "next skips a page",
      attempt({
        status: "available",
        snapshot: snapshot(),
        pagination: page({ next_page: 5 }),
      }),
    ],
    [
      "limit with next",
      attempt({
        status: "available",
        snapshot: snapshot(),
        pagination: page({ limit_reached: true }),
      }),
    ],
    [
      "pagination extra key",
      attempt({
        status: "available",
        snapshot: snapshot(),
        pagination: { ...page(), total: 99 },
      }),
    ],
    [
      "pagination on discovery",
      attempt({
        status: "available",
        snapshot: snapshot({
          url: commitsUrl,
          final_url: commitsUrl,
          text: discoveryText(),
        }),
        pagination: page(),
      }),
    ],
    [
      "pagination without snapshot",
      attempt({ status: "unavailable", snapshot: null, pagination: page() }),
    ],
  ])("fails closed on %s", (_, a) => {
    expect(githubReceipt(a, WS).kind).toBe("unverified");
    expect(toolAttemptRow(a, WS).tone).toBe("unknown");
  });

  it("states next page, limit and end truthfully", () => {
    const with_ = (p: unknown) =>
      html(
        attempt({
          status: "available",
          snapshot: snapshot(),
          source: "fixture",
          pagination: p,
        }),
      );
    expect(with_(page())).toContain("More exist — page 3 was not read.");
    expect(
      with_(page({ next_page: null, has_more: true, limit_reached: true })),
    ).toContain("Page limit reached");
    expect(with_(page({ next_page: null, has_more: false }))).toContain(
      "No further pages.",
    );
    expect(with_(null)).toContain("Whether more pages exist is not recorded.");
    const r = githubReceipt(
      attempt({
        status: "available",
        snapshot: snapshot(),
        pagination: page(),
      }),
      WS,
    );
    expect(r.kind === "result" && r.pagination).toEqual({
      page: 2,
      perPage: 10,
      itemCount: 2,
      nextPage: 3,
      hasMore: true,
      limitReached: false,
    });
  });
});
