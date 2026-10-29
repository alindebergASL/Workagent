/**
 * Stateful race tests for the research views. The real ArtifactCitations and
 * ResearchSources components are rendered over the real fenced readers they
 * use in production; only the transport is controlled (deferred promises),
 * so responses can be made to land late, out of order, or after a denial.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "../src/lib/contract/errors";
import {
  createCitationsReader,
  createSourcesReader,
} from "../src/lib/research-readers";
import {
  ArtifactCitations,
  ResearchSources,
} from "../src/components/ResearchSources";
import type {
  ArtifactClaims,
  ClaimFreshness,
  PublicEvidence,
  ResearchSnapshotPage,
  SourceSnapshot,
} from "../src/lib/research-contract";

const H = (c: string) => c.repeat(64);
const TEXT = "Prices rose 4% in 2026 across the region.";
const QUOTE = "Prices rose 4% in 2026";
const CAPTURED_MARK = "across the region";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  signal?: AbortSignal;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const notFound = () =>
  new ApiError({
    code: "not_found_or_not_authorized",
    status: 404,
    message: "",
  } as ConstructorParameters<typeof ApiError>[0]);

function snapshot(id: string, text = TEXT): SourceSnapshot {
  const locator: PublicEvidence = {
    kind: "public_source",
    blob_id: "blob_1",
    sha256: H("a"),
    mime_type: "text/html",
    title: `Report ${id}`,
    url: "https://example.org/r",
    final_url: "https://example.org/r",
    status_code: 200,
    redirects: [],
    fetched_at: "2026-10-28T12:00:00Z",
    extractor_version: "readable-1",
    coverage: { body_complete: true, text_complete: true, omissions: [] },
    external_version: { etag: null, last_modified: null },
    extraction_status: "extracted",
    browser_used: false,
    text,
    text_sha256: H("b"),
    run_id: "run_1",
    tool_attempt_id: "att_1",
  };
  return {
    snapshot_id: id,
    workspace_file_id: "wf_1",
    workspace_id: "ws_1",
    conversation_id: "c_1",
    version_number: 1,
    parent_snapshot_id: null,
    locator,
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

const BINDING = { artifactId: "art_1", revisionId: "rev_1", bodyHash: H("c") };

function claims(
  freshness: ClaimFreshness["freshness"] = "current",
  newer: string[] = [],
): ArtifactClaims {
  return {
    artifact_id: BINDING.artifactId,
    revision_id: BINDING.revisionId,
    body_hash: BINDING.bodyHash,
    semantic_notice: "Exact quotes verify attribution, not claim truth.",
    items: [
      {
        claim: {
          artifact_id: BINDING.artifactId,
          revision_id: BINDING.revisionId,
          body_hash: BINDING.bodyHash,
          claim: "Regional prices rose in 2026.",
          evidence: [
            {
              workspace_file_id: "wf_1",
              snapshot_id: "snap_1",
              text_sha256: H("b"),
              start: 0,
              end: QUOTE.length,
              quote: QUOTE,
              relation: "supports",
            },
          ],
          claim_id: "claim_1",
          workspace_id: "ws_1",
          conversation_id: "c_1",
          run_id: "run_1",
          tool_attempt_id: "att_1",
          created_at: "2026-10-28T12:01:00Z",
          attribution: "exact_quotes_only",
          semantic_status: "not_assessed",
        },
        freshness,
        newer_snapshot_ids: newer,
        coverage: ["extracted"],
      },
    ],
  };
}

function citationsWorld() {
  const claimCalls: Deferred<ArtifactClaims>[] = [];
  const snapCalls: (Deferred<SourceSnapshot> & { id: string })[] = [];
  const reader = createCitationsReader({
    binding: BINDING,
    fetchClaims: (signal) => {
      const d = deferred<ArtifactClaims>();
      d.signal = signal;
      claimCalls.push(d);
      return d.promise;
    },
    fetchSnapshot: (id, signal) => {
      const d = Object.assign(deferred<SourceSnapshot>(), { id, signal });
      snapCalls.push(d);
      return d.promise;
    },
  });
  const view = () =>
    renderToStaticMarkup(
      createElement(ArtifactCitations, {
        ws: "ws_1",
        ...BINDING,
        reader,
      }),
    );
  return { reader, claimCalls, snapCalls, view };
}

function expectNothingSensitive(html: string) {
  expect(html).not.toContain(QUOTE);
  expect(html).not.toContain("Regional prices rose");
  expect(html).not.toContain(CAPTURED_MARK);
  expect(html).not.toContain("snap_1");
}

describe("citations: canonical 404 after visible data", () => {
  it("a 404 on a capture check clears claims, quotes and captured text", async () => {
    const w = citationsWorld();
    w.reader.refresh();
    w.claimCalls[0]!.resolve(claims());
    await flush();
    w.reader.loadSnapshot("snap_1");
    w.snapCalls[0]!.resolve(snapshot("snap_1"));
    await flush();
    const before = w.view();
    expect(before).toContain(QUOTE);
    expect(before).toContain(CAPTURED_MARK);

    // A second check is pending when access is withdrawn.
    w.reader.loadSnapshot("snap_2");
    w.reader.loadSnapshot("snap_1");
    w.snapCalls[1]!.reject(notFound());
    await flush();
    let after = w.view();
    expectNothingSensitive(after);
    expect(after).toContain("aren’t available to you now");
    expect(w.snapCalls[2]!.signal!.aborted).toBe(true);

    // The older pending success lands late: nothing comes back.
    w.snapCalls[2]!.resolve(snapshot("snap_1"));
    await flush();
    after = w.view();
    expectNothingSensitive(after);
    expect(w.reader.getSnapshot().snapshots).toEqual({});
  });

  it("a 404 on a citations refresh clears what was shown", async () => {
    const w = citationsWorld();
    w.reader.refresh();
    w.claimCalls[0]!.resolve(claims());
    await flush();
    expect(w.view()).toContain(QUOTE);
    w.reader.refresh();
    expectNothingSensitive(w.view());
    w.claimCalls[1]!.reject(notFound());
    await flush();
    const html = w.view();
    expectNothingSensitive(html);
    expect(html).toContain('data-testid="claims-error"');
    // Refresh stays available after a failure.
    expect(html).toContain("Refresh citations");
  });

  it("a stale success from an earlier refresh never overwrites the newer one", async () => {
    const w = citationsWorld();
    w.reader.refresh();
    w.reader.refresh();
    expect(w.claimCalls[0]!.signal!.aborted).toBe(true);
    w.claimCalls[1]!.resolve(claims("potentially_stale", ["snap_9"]));
    await flush();
    w.claimCalls[0]!.resolve(claims("current"));
    await flush();
    expect(w.view()).toContain('data-testid="claims-stale-badge"');
  });

  it("an earlier refresh that fails late cannot clear the newer result", async () => {
    const w = citationsWorld();
    w.reader.refresh();
    w.reader.refresh();
    w.claimCalls[1]!.resolve(claims());
    await flush();
    w.claimCalls[0]!.reject(notFound());
    await flush();
    expect(w.view()).toContain("Regional prices rose");
  });

  it("after unmount (dispose) a late success shows nothing", async () => {
    const w = citationsWorld();
    w.reader.refresh();
    w.reader.dispose();
    expect(w.claimCalls[0]!.signal!.aborted).toBe(true);
    w.claimCalls[0]!.resolve(claims());
    await flush();
    expectNothingSensitive(w.view());
  });

  it("refuses claims answered for a different revision or body", async () => {
    const w = citationsWorld();
    w.reader.refresh();
    w.claimCalls[0]!.resolve({ ...claims(), body_hash: H("d") });
    await flush();
    const html = w.view();
    expectNothingSensitive(html);
    expect(html).toContain("different version of this work");
  });
});

describe("citations: live refresh on an already-mounted card", () => {
  it("shows a newly stale source without touching the human revision", async () => {
    const w = citationsWorld();
    w.reader.refresh();
    w.claimCalls[0]!.resolve(claims("current"));
    await flush();
    const first = w.view();
    expect(first).not.toContain('data-testid="claims-stale-badge"');

    // A newer capture was added for the same exact revision + body.
    w.reader.refresh();
    const checking = w.view();
    expect(checking).toContain("Checking…");
    expectNothingSensitive(checking);
    w.claimCalls[1]!.resolve(claims("potentially_stale", ["snap_2"]));
    await flush();
    const html = w.view();
    expect(html).toContain('data-testid="claims-stale-badge"');
    expect(html).toContain('data-testid="stale-warning"');
    expect(html).toContain("snap_2");
    expect(html).toContain("have not been changed");
    // The exact human revision and body binding are unchanged.
    expect(w.reader.getSnapshot().claims!.revision_id).toBe("rev_1");
    expect(w.reader.getSnapshot().claims!.body_hash).toBe(H("c"));
    expect(html).toContain(H("c"));
  });

  it("keeps a refresh control when nothing is cited yet, worded as read-only", async () => {
    const w = citationsWorld();
    w.reader.refresh();
    w.claimCalls[0]!.resolve({ ...claims(), items: [] });
    await flush();
    const html = w.view();
    expect(html).toContain('data-testid="claims-empty"');
    expect(html).toContain("Refresh citations");
    expect(html).toContain("nothing new is fetched from the web");
  });
});

describe("sources: refresh, pagination and denial", () => {
  function sourcesWorld() {
    const calls: (Deferred<ResearchSnapshotPage> & {
      after: string | null;
    })[] = [];
    const reader = createSourcesReader({
      fetchPage: (after, signal) => {
        const d = Object.assign(deferred<ResearchSnapshotPage>(), {
          after,
          signal,
        });
        calls.push(d);
        return d.promise;
      },
    });
    const view = () =>
      renderToStaticMarkup(
        createElement(ResearchSources, { ws: "ws_1", cid: "c_1", reader }),
      );
    return { reader, calls, view };
  }

  it("an already-mounted list picks up a newly added source on refresh", async () => {
    const w = sourcesWorld();
    w.reader.refresh();
    w.calls[0]!.resolve({ items: [snapshot("snap_1")], next_after: null });
    await flush();
    expect(w.view()).toContain("Report snap_1");
    w.reader.refresh();
    expect(w.view()).not.toContain("Report snap_1");
    w.calls[1]!.resolve({
      items: [snapshot("snap_1"), snapshot("snap_2")],
      next_after: null,
    });
    await flush();
    const html = w.view();
    expect(html).toContain("Report snap_1");
    expect(html).toContain("Report snap_2");
    expect(html).toContain("Refresh sources");
    expect(html).toContain("nothing new is fetched from the web");
  });

  it("a 404 on a further page clears every source shown", async () => {
    const w = sourcesWorld();
    w.reader.refresh();
    w.calls[0]!.resolve({ items: [snapshot("snap_1")], next_after: "snap_1" });
    await flush();
    expect(w.view()).toContain("1 shown; more sources exist.");
    w.reader.more();
    expect(w.calls[1]!.after).toBe("snap_1");
    w.calls[1]!.reject(notFound());
    await flush();
    const html = w.view();
    expect(html).not.toContain("Report snap_1");
    expect(html).not.toContain(CAPTURED_MARK);
    expect(html).toContain("aren’t available to you now");
  });

  it("a page requested before a refresh cannot append to the new list", async () => {
    const w = sourcesWorld();
    w.reader.refresh();
    w.calls[0]!.resolve({ items: [snapshot("snap_1")], next_after: "snap_1" });
    await flush();
    w.reader.more();
    w.reader.refresh();
    expect(w.calls[1]!.signal!.aborted).toBe(true);
    w.calls[2]!.resolve({ items: [snapshot("snap_3")], next_after: null });
    await flush();
    w.calls[1]!.resolve({ items: [snapshot("snap_old")], next_after: null });
    await flush();
    const html = w.view();
    expect(html).toContain("Report snap_3");
    expect(html).not.toContain("Report snap_old");
    expect(html).not.toContain("Report snap_1");
  });

  it("after unmount a late page shows nothing", async () => {
    const w = sourcesWorld();
    w.reader.refresh();
    w.reader.dispose();
    w.calls[0]!.resolve({ items: [snapshot("snap_1")], next_after: null });
    await flush();
    expect(w.view()).not.toContain("Report snap_1");
  });
});
