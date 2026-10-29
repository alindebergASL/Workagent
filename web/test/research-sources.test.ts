import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  appendSnapshotPage,
  checkQuote,
  codePointSlice,
  coverageNotes,
  safeHttpsHref,
  type ArtifactClaims,
  type ClaimFreshness,
  type PublicEvidence,
  type QuoteRef,
  type SourceSnapshot,
} from "../src/lib/research-contract";
import {
  ClaimsList,
  ClaimView,
  ResearchSourceList,
  SnapshotDetails,
} from "../src/components/ResearchSources";

const H = (c: string) => c.repeat(64);
const TEXT = "Café 🌍 prices rose 4% in 2026. Other reports say they fell.";

function evidence(over: Partial<PublicEvidence> = {}): PublicEvidence {
  return {
    kind: "public_source",
    blob_id: "blob_1",
    sha256: H("a"),
    mime_type: "text/html",
    title: "Prices report",
    url: "https://example.org/r",
    final_url: "https://example.org/report",
    status_code: 200,
    redirects: [
      { url: "https://example.org/r", status: 301, location: "/report" },
    ],
    fetched_at: "2026-10-28T12:00:00Z",
    extractor_version: "readable-1",
    coverage: { body_complete: true, text_complete: true, omissions: [] },
    external_version: { etag: '"v1"', last_modified: null },
    extraction_status: "extracted",
    browser_used: false,
    text: TEXT,
    text_sha256: H("b"),
    run_id: "run_1",
    tool_attempt_id: "att_1",
    ...over,
  };
}

function snapshot(
  id: string,
  ev: Partial<PublicEvidence> = {},
): SourceSnapshot {
  return {
    snapshot_id: id,
    workspace_file_id: "wf_1",
    workspace_id: "ws_1",
    conversation_id: "c_1",
    version_number: 1,
    parent_snapshot_id: null,
    locator: evidence(ev),
    observed_at: "2026-10-28T12:00:00Z",
    version_at: null,
    original_sha256: H("a"),
    extraction_sha256: H("b"),
    original_byte_length: 100,
    extraction_byte_length: 60,
    parser_version: "readable-1",
    extraction_status: "extracted",
    coverage: { body_complete: true, text_complete: true, omissions: [] },
    omissions: [],
    trust_label: "untrusted_evidence",
  } as SourceSnapshot;
}

// "prices rose 4% in 2026." starts after "Café 🌍 " — 7 code points, 8 UTF-16 units.
const QUOTE = "prices rose 4% in 2026.";
const start = Array.from(TEXT).join("").indexOf("prices"); // UTF-16 index
const cpStart = Array.from(TEXT.slice(0, start)).length;

function ref(over: Partial<QuoteRef> = {}): QuoteRef {
  return {
    workspace_file_id: "wf_1",
    snapshot_id: "snap_1",
    text_sha256: H("b"),
    start: cpStart,
    end: cpStart + Array.from(QUOTE).length,
    quote: QUOTE,
    relation: "supports",
    ...over,
  };
}

function item(over: Partial<ClaimFreshness> = {}, claimOver = {}) {
  return {
    claim: {
      artifact_id: "art_1",
      revision_id: "rev_1",
      body_hash: H("c"),
      claim: "Prices rose in 2026.",
      evidence: [ref()],
      claim_id: "claim_1",
      workspace_id: "ws_1",
      conversation_id: "c_1",
      run_id: "run_1",
      tool_attempt_id: "att_1",
      created_at: "2026-10-28T12:01:00Z",
      attribution: "exact_quotes_only",
      semantic_status: "not_assessed",
      ...claimOver,
    },
    freshness: "current",
    newer_snapshot_ids: [],
    coverage: ["extracted"],
    ...over,
  } as ClaimFreshness;
}

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el);

describe("exact quote references", () => {
  it("uses Unicode code-point ranges, not UTF-16 units", () => {
    expect(cpStart).toBe(7);
    expect(codePointSlice(TEXT, ref().start, ref().end)).toBe(QUOTE);
  });
  it("matches only the exact cited capture and range", () => {
    const s = snapshot("snap_1");
    const ok = checkQuote(ref(), s);
    expect(ok.state).toBe("matches");
    expect(
      checkQuote(
        ref({ start: cpStart + 1, end: cpStart + 1 + QUOTE.length }),
        s,
      ).state,
    ).toBe("mismatch");
    expect(checkQuote(ref({ text_sha256: H("d") }), s).state).toBe(
      "different_capture",
    );
    expect(checkQuote(ref(), snapshot("snap_2")).state).toBe(
      "different_capture",
    );
    expect(checkQuote(ref(), undefined).state).toBe("not_loaded");
  });
  it("renders the exact quote, range, snapshot and hash next to the claim", () => {
    const out = html(
      createElement(ClaimView, {
        item: item(),
        snapshots: { snap_1: snapshot("snap_1") },
      }),
    );
    expect(out).toContain(QUOTE.replace("%", "%"));
    expect(out).toContain(`Characters 7–${7 + QUOTE.length}`);
    expect(out).toContain("snap_1");
    expect(out).toContain('data-testid="quote-matches"');
    expect(out).toContain("<mark>");
    expect(out).not.toMatch(
      /confidence|verified true|\d+%\s*(sure|confident)/i,
    );
  });
});

describe("freshness and claimed relationships", () => {
  it("warns about a changed source without rebasing or accepting anything", () => {
    const out = html(
      createElement(ClaimView, {
        item: item({
          freshness: "potentially_stale",
          newer_snapshot_ids: ["snap_9"],
        }),
        snapshots: { snap_1: snapshot("snap_1") },
        onLoad: () => {},
      }),
    );
    expect(out).toContain('data-testid="stale-warning"');
    expect(out).toContain("Source may have changed");
    expect(out).toContain("snap_9");
    expect(out).toContain("have not been");
    expect(out).toContain("original capture stays available");
    // The original cited capture is still the one checked against.
    expect(out).toContain('data-testid="quote-matches"');
    expect(out).not.toMatch(/accept|apply update|rebase/i);
  });
  it("shows both sides of a conflict and no confidence badge", () => {
    const out = html(
      createElement(ClaimView, {
        item: item(
          {},
          {
            semantic_status: "conflict",
            evidence: [
              ref(),
              ref({
                relation: "contradicts",
                start: 33,
                end: 59,
                quote: Array.from(TEXT).slice(33, 59).join(""),
              }),
            ],
          },
        ),
        snapshots: {},
      }),
    );
    expect(out).toContain("Sources disagree");
    expect(out).toContain("Supporting");
    expect(out).toContain("Contradicting");
    expect(out).toContain('data-relation="supports"');
    expect(out).toContain('data-relation="contradicts"');
    expect(out).not.toMatch(/confidence|likely true|score/i);
  });
  it("says unsupported and not-assessed plainly; attribution is not truth", () => {
    const un = html(
      createElement(ClaimView, {
        item: item({}, { semantic_status: "unsupported", evidence: [] }),
        snapshots: {},
      }),
    );
    expect(un).toContain("No supporting quote");
    expect(un).toContain('data-testid="no-evidence"');
    const na = html(createElement(ClaimView, { item: item(), snapshots: {} }));
    expect(na).toContain("not verified by them");
  });
  it("names incomplete coverage on the claim", () => {
    const out = html(
      createElement(ClaimView, {
        item: item({ coverage: ["truncated", "empty"] }),
        snapshots: {},
      }),
    );
    expect(out).toContain('data-testid="claim-coverage"');
    expect(out).toContain("only part of the text was captured");
    expect(out).toContain("the page had no readable text");
  });
});

describe("capture metadata", () => {
  it("names bounded, empty and partial-render captures", () => {
    const ev = evidence({
      extraction_status: "truncated",
      browser_used: true,
      coverage: {
        body_complete: false,
        text_complete: false,
        omissions: ["images", "scripts"],
      },
    });
    const notes = coverageNotes(ev).join(" ");
    expect(notes).toContain("Only part of the text");
    expect(notes).toContain("not fully retrieved");
    expect(notes).toContain("rendering may be partial");
    expect(notes).toContain("Omitted: images");
    const empty = html(
      createElement(SnapshotDetails, {
        snapshot: snapshot("s", { extraction_status: "empty", text: "" }),
      }),
    );
    expect(empty).toContain("The page had no readable text");
    expect(empty).toContain("No text was captured.");
  });
  it("shows exact hashes, URLs, redirects, time and untrusted label", () => {
    const out = html(
      createElement(SnapshotDetails, { snapshot: snapshot("snap_1") }),
    );
    expect(out).toContain(H("a"));
    expect(out).toContain(H("b"));
    expect(out).toContain("https://example.org/report");
    expect(out).toContain("301 https://example.org/r → /report");
    expect(out).toContain('dateTime="2026-10-28T12:00:00Z"');
    expect(out).toContain("untrusted");
    expect(out).toContain("run_1");
    expect(out).toContain('data-testid="coverage-complete"');
  });
});

describe("sanitization", () => {
  it("links only plain https URLs, without credentials", () => {
    expect(safeHttpsHref("https://example.org/a?b=1")).toBe(
      "https://example.org/a?b=1",
    );
    for (const bad of [
      "javascript:alert(1)",
      "http://example.org",
      "data:text/html,<script>",
      "/relative",
      "https://user:pw@example.org/",
      "not a url",
      "",
      null,
    ])
      expect(safeHttpsHref(bad)).toBeNull();
  });
  it("renders hostile titles, text and URLs as inert text", () => {
    const out = html(
      createElement(SnapshotDetails, {
        snapshot: snapshot("x", {
          title: '<img src=x onerror="alert(1)">',
          text: "<script>alert(1)</script>",
          final_url: "javascript:alert(1)",
        }),
      }),
    );
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toMatch(/href="javascript:/);
    expect(out).toContain("not a secure https link");
  });
  it("opens safe links in a new tab without opener or referrer", () => {
    const out = html(
      createElement(SnapshotDetails, { snapshot: snapshot("y") }),
    );
    expect(out).toMatch(
      /<a href="https:\/\/example.org\/report" target="_blank" rel="noopener noreferrer nofollow">/,
    );
  });
});

describe("errors, revocation and pagination", () => {
  const claims: ArtifactClaims = {
    artifact_id: "art_1",
    revision_id: "rev_1",
    body_hash: H("c"),
    items: [item()],
    semantic_notice: "Exact quotes verify attribution, not claim truth.",
  };
  it("a failed or revoked read shows only the refusal, never stale claims", () => {
    const out = html(
      createElement(ClaimsList, {
        claims,
        error: "These sources aren’t available to you now.",
        snapshots: { snap_1: snapshot("snap_1") },
      }),
    );
    expect(out).toContain('data-testid="claims-error"');
    expect(out).not.toContain(QUOTE);
    expect(out).not.toContain("Prices rose in 2026.");
  });
  it("source list error shows no sources", () => {
    const out = html(
      createElement(ResearchSourceList, {
        items: null,
        error: "These sources aren’t available to you now.",
        hasMore: false,
      }),
    );
    expect(out).toContain('role="alert"');
    expect(out).not.toContain("data-snapshot");
  });
  it("says more sources exist instead of silently omitting them", () => {
    const out = html(
      createElement(ResearchSourceList, {
        items: [snapshot("a")],
        error: null,
        hasMore: true,
      }),
    );
    expect(out).toContain("1 shown; more sources exist.");
    expect(out).toContain("Show more sources");
  });
  it("appends further pages in order without dropping or duplicating", () => {
    const merged = appendSnapshotPage([snapshot("a"), snapshot("b")], {
      items: [snapshot("b"), snapshot("c")],
      next_after: null,
    });
    expect(merged.map((s) => s.snapshot_id)).toEqual(["a", "b", "c"]);
  });
  it("shows the notice that attribution is not truth", () => {
    const out = html(
      createElement(ClaimsList, { claims, error: null, snapshots: {} }),
    );
    expect(out).toContain("Exact quotes verify attribution, not claim truth.");
  });
});
