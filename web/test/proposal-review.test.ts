import { describe, expect, it } from "vitest";
import {
  ackPayload,
  acksFor,
  byCreated,
  canAccept,
  canonicalPath,
  candidates,
  localRemovals,
  reviewOf,
  type ReviewableProposal,
  selectedComparison,
} from "../src/lib/proposal-review";

const p = (
  id: string,
  created_at: string,
  over: Partial<ReviewableProposal> = {},
): ReviewableProposal => ({
  id,
  status: "pending",
  base_revision_id: "r1",
  created_at,
  body: { notes: ["keep me"], rows: [] },
  ...over,
});
const saved = { notes: ["keep me"], rows: [] };

describe("which proposal is the latest", () => {
  it("orders by created_at then id, not by page order or id alone", () => {
    const c = candidates(
      [
        p("zzz", "2026-10-22T10:00:00Z"),
        p("aaa", "2026-10-22T12:00:00Z"),
        p("mmm", "2026-10-22T11:00:00Z"),
      ],
      "r1",
    );
    expect(c.latest?.id).toBe("aaa");
    expect(c.earlier.map((x) => x.id)).toEqual(["mmm", "zzz"]);
  });
  it("breaks a created_at tie by id", () => {
    const c = candidates(
      [p("b", "2026-10-22T10:00:00Z"), p("a", "2026-10-22T10:00:00Z")],
      "r1",
    );
    expect(c.latest?.id).toBe("b");
  });
  it("keeps out-of-date and closed proposals out of the candidates", () => {
    const c = candidates(
      [
        p("old", "2026-10-22T13:00:00Z", { base_revision_id: "r0" }),
        p("done", "2026-10-22T14:00:00Z", { status: "accepted" }),
        p("now", "2026-10-22T10:00:00Z"),
      ],
      "r1",
    );
    expect(c.latest?.id).toBe("now");
    expect(c.outdated.map((x) => x.id)).toEqual(["old"]);
    expect(c.earlier).toEqual([]);
  });
  it("follows the service's latest when the candidates agree on it", () => {
    const review = {
      latest_pending_proposal_id: "x",
      is_latest: false,
      removed_content: [],
      removed_content_count: 0,
    };
    const c = candidates(
      [
        p("x", "2026-10-22T10:00:00Z", {
          review: { ...review, is_latest: true },
        }),
        p("y", "2026-10-22T11:00:00Z", { review }),
      ],
      "r1",
    );
    expect(c.latest?.id).toBe("x");
  });
});

describe("an earlier candidate", () => {
  const list = [
    p("first", "2026-10-22T10:00:00Z", { body: { notes: [], rows: [] } }),
    p("second", "2026-10-22T11:00:00Z"),
    p("third", "2026-10-22T12:00:00Z"),
  ];
  const latest = candidates(list, "r1").latest!.id;
  it("needs acknowledging, and its removed note is listed", () => {
    const r = reviewOf(list[0]!, saved, latest);
    expect(r.isLatest).toBe(false);
    expect(r.needsOlderAck).toBe(true);
    expect(r.removed).toEqual([{ path: "/notes/0", before: "keep me" }]);
    expect(canAccept(r, acksFor(undefined, r))).toBe(false);
    expect(canAccept(r, { ...acksFor(undefined, r), older: true })).toBe(false);
    const both = { ...acksFor(undefined, r), older: true, removed: true };
    expect(canAccept(r, both)).toBe(true);
    expect(ackPayload(r, both)).toEqual({
      acknowledge_removed_content: true,
      acknowledge_older_proposal: true,
    });
  });
  it("the latest with nothing removed needs no acknowledgement or flags", () => {
    const r = reviewOf(list[2]!, saved, latest);
    expect(r.isLatest).toBe(true);
    expect(canAccept(r, acksFor(undefined, r))).toBe(true);
    expect(ackPayload(r, acksFor(undefined, r))).toEqual({});
  });
  it("acknowledgements reset when the candidate's review changes", () => {
    const r = reviewOf(list[0]!, saved, latest);
    const given = { ...acksFor(undefined, r), older: true, removed: true };
    const changed = reviewOf(list[0]!, saved, "someone-else");
    expect(acksFor(given, changed)).toEqual({
      signature: changed.signature,
      older: false,
      removed: false,
    });
    const newBase = reviewOf(
      { ...list[0]!, base_revision_id: "r2" },
      saved,
      latest,
    );
    expect(canAccept(newBase, given)).toBe(false);
  });
});

describe("service review and missing metadata", () => {
  it("a service saying nothing is removed doesn't hide a local removal", () => {
    const r = reviewOf(
      p("a", "t", {
        body: { notes: [], rows: [] },
        review: {
          latest_pending_proposal_id: "a",
          is_latest: true,
          removed_content: [],
          removed_content_count: 0,
        },
      }),
      saved,
      "a",
    );
    expect(r.needsRemovalAck).toBe(true);
  });
  it("counts what the service found beyond the details it listed", () => {
    const r = reviewOf(
      p("a", "t", {
        review: {
          latest_pending_proposal_id: "a",
          is_latest: true,
          removed_content: [{ path: "blocks[b1]", before: "Intro" }],
          removed_content_count: 3,
        },
      }),
      saved,
      "a",
    );
    expect(r.removedCount).toBe(3);
    expect(r.served).toBe(true);
  });
  it("a service that says this isn't the latest is believed", () => {
    const r = reviewOf(
      p("a", "t", {
        review: {
          latest_pending_proposal_id: "b",
          is_latest: false,
          removed_content: [],
          removed_content_count: 0,
        },
      }),
      saved,
      "a",
    );
    expect(r.needsOlderAck).toBe(true);
  });
});

describe("which comparison opens", () => {
  const list = [{ id: "old" }, { id: "new" }, { id: "older" }];
  it("opens the chosen proposal, else the latest, else the first", () => {
    expect(selectedComparison(list, "older", "new")?.id).toBe("older");
    expect(selectedComparison(list, null, "new")?.id).toBe("new");
    expect(selectedComparison(list, "gone", "new")?.id).toBe("new");
    expect(selectedComparison(list, "gone", null)?.id).toBe("old");
    expect(selectedComparison([], "old", "new")).toBeUndefined();
  });
});

describe("what a proposal takes out", () => {
  it("reads notes, rows and blocks of any kind of work", () => {
    expect(
      localRemovals(
        {
          notes: ["a", "b"],
          rows: [
            { row_id: "r1", cells: [{ value: "Alpha" }, { value: 2 }] },
            { row_id: "r2", cells: [] },
          ],
        },
        { notes: ["b"], rows: [{ row_id: "r2", cells: [] }] },
      ),
    ).toEqual([
      { path: "/notes/0", before: "a" },
      {
        path: "/rows/r1",
        before: '{"cells":[{"value":"Alpha"},{"value":2}],"row_id":"r1"}',
      },
    ]);
    expect(
      localRemovals(
        {
          blocks: [
            { block_id: "b1", kind: "paragraph", text: "Intro" },
            { block_id: "b2", kind: "protected_note", text: "Mine" },
            { block_id: "b3", kind: "paragraph", text: "Same" },
          ],
        },
        {
          blocks: [
            { block_id: "b2", kind: "protected_note", text: "Rewritten" },
            { block_id: "b3", kind: "paragraph", text: "Same" },
          ],
        },
      ),
    ).toEqual([
      {
        path: "/blocks/b1",
        before: '{"block_id":"b1","kind":"paragraph","text":"Intro"}',
      },
      { path: "/blocks/b2/text", before: "Mine" },
    ]);
  });
  it("sees a dropped duplicate note, a replaced field and replaced text", () => {
    expect(
      localRemovals(
        {
          notes: ["same", "same"],
          fields: [{ field_key: "owner", value: "Ana" }],
          blocks: [{ block_id: "a/b", kind: "paragraph", text: "Keep this" }],
          "a/b~c": "x",
        },
        {
          notes: ["same"],
          fields: [{ field_key: "owner", value: "Bo" }],
          blocks: [
            { block_id: "a/b", kind: "paragraph", text: "Keep this and more" },
          ],
          "a/b~c": "y",
        },
      ),
    ).toEqual([
      { path: "/notes/1", before: "same" },
      { path: "/fields/owner/value", before: "Ana" },
      { path: "/a~1b~0c", before: "x" },
    ]);
  });
  it("lets only document block text grow; typed values compare exactly", () => {
    expect(
      localRemovals(
        {
          text: "Keep this",
          rows: [{ row_id: "r1", cells: { amount: "10.00", state: "open" } }],
          blocks: [{ block_id: "b1", meta: { text: "Keep" } }],
        },
        {
          text: "Keep this and more",
          rows: [
            { row_id: "r1", cells: { amount: "110.00", state: "reopen" } },
          ],
          blocks: [{ block_id: "b1", meta: { text: "Keep more" } }],
        },
      ),
    ).toEqual([
      { path: "/text", before: "Keep this" },
      { path: "/rows/r1/cells/amount", before: "10.00" },
      { path: "/rows/r1/cells/state", before: "open" },
      { path: "/blocks/b1/meta/text", before: "Keep" },
    ]);
  });
  it("ignores only the root metadata of its own kind of work", () => {
    expect(
      localRemovals(
        { kind: "file", content_sha256: "a", name: "x" },
        { kind: "file", content_sha256: "b", name: "x" },
      ),
    ).toEqual([]);
    expect(
      localRemovals(
        { kind: "custom_view", access_generation: 1 },
        { kind: "custom_view", access_generation: 2 },
      ),
    ).toEqual([]);
    expect(
      localRemovals(
        {
          kind: "table",
          access_generation: 1,
          rows: [{ row_id: "r1", content_sha256: "abc", access_generation: 3 }],
        },
        {
          kind: "table",
          access_generation: 2,
          rows: [
            { row_id: "r1", content_sha256: "abcd", access_generation: 4 },
          ],
        },
      ),
    ).toEqual([
      { path: "/access_generation", before: "1" },
      { path: "/rows/r1/content_sha256", before: "abc" },
      { path: "/rows/r1/access_generation", before: "3" },
    ]);
    expect(
      localRemovals(
        { kind: "file", rows: [{ row_id: "r1", content_sha256: "abc" }] },
        { kind: "file", rows: [{ row_id: "r1", content_sha256: "abcd" }] },
      ),
    ).toEqual([{ path: "/rows/r1/content_sha256", before: "abc" }]);
  });
  it("counts a loss the service and this reading both name once, kept whole", () => {
    const long = "n".repeat(600);
    const r = reviewOf(
      {
        id: "p1",
        status: "pending",
        base_revision_id: "rev",
        body: { notes: [] },
        review: {
          latest_pending_proposal_id: "p1",
          is_latest: true,
          removed_content: [
            { path: "/notes/0", before: "n".repeat(499) + "…" },
          ],
          removed_content_count: 3,
        },
      },
      { notes: [long] },
      "p1",
    );
    expect(r.removed).toEqual([{ path: "/notes/0", before: long }]);
    // The service's complete count stands; the shared entry isn't added again.
    expect(r.removedCount).toBe(3);
    expect(canonicalPath("notes[0]")).toBe("/notes/0");
    expect(canonicalPath("/a~1b~0c")).toBe("/a~1b~0c");
  });
  it("orders by the instant, across offsets, and never calls an unreadable time latest", () => {
    const a = {
      id: "a",
      status: "pending",
      base_revision_id: "rev",
      created_at: "2026-10-22T10:00:00+02:00", // 08:00Z
      body: {},
    };
    const b = { ...a, id: "b", created_at: "2026-10-22T09:00:00Z" };
    expect([b, a].sort(byCreated).map((p) => p.id)).toEqual(["a", "b"]);
    expect(candidates([a, b], "rev").latest?.id).toBe("b");
    const c = { ...a, id: "c", created_at: "not a time" };
    const split = candidates([a, b, c], "rev");
    expect(split.latest).toBeNull();
    expect(split.earlier).toHaveLength(3);
  });
  it("calls a lone candidate the latest, whatever its time says", () => {
    const only = {
      id: "only",
      status: "pending",
      base_revision_id: "rev",
      body: {},
    };
    for (const created_at of [undefined, "not a time"]) {
      const split = candidates([{ ...only, created_at }], "rev");
      expect(split.latest?.id).toBe("only");
      expect(split.earlier).toEqual([]);
    }
  });
  it("finds nothing when nothing is taken out", () => {
    expect(
      localRemovals(saved, { notes: ["keep me", "new"], rows: [] }),
    ).toEqual([]);
  });
});
