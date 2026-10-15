import { describe, expect, it } from "vitest";
import { resolveScope, scopedHref } from "../src/lib/scope";
import { resultLink } from "../src/lib/result-links";
import { activityFrom } from "../src/lib/activity";

const old = { id: "ws_old", kind: "personal" };
const fresh = { id: "ws_new", kind: "personal" };

describe("a record link names the workspace it lives in", () => {
  it("adds the workspace and keeps any other query and the fragment", () => {
    expect(scopedHref("/conversations/c1", "ws_new")).toBe(
      "/conversations/c1?workspace=ws_new",
    );
    expect(
      scopedHref("/conversations/c1/artifacts/a?revision=r 1#top", "ws:x"),
    ).toBe("/conversations/c1/artifacts/a?revision=r+1&workspace=ws%3Ax#top");
    expect(scopedHref("/assignments/h1#run-r", "ws_new")).toBe(
      "/assignments/h1?workspace=ws_new#run-r",
    );
  });
  it("leaves other pages, and an unknown workspace, alone", () => {
    expect(scopedHref("/spaces/ws_new", "ws_new")).toBe("/spaces/ws_new");
    expect(scopedHref("/", "ws_new")).toBe("/");
    expect(scopedHref("/conversations/c1", null)).toBe("/conversations/c1");
  });
  it("a result link and its current-version link both carry it", () => {
    const l = resultLink(
      "/conversations/c1",
      { artifact_id: "a", kind: "document", revision_id: "r1" },
      { current_revision_id: "r2" },
      "ws_new",
    );
    expect(l.href).toBe(
      "/conversations/c1/artifacts/a?revision=r1&workspace=ws_new",
    );
    expect(l.current?.href).toBe(
      "/conversations/c1/artifacts/a?workspace=ws_new",
    );
  });
  it("activity links use each record's own workspace", () => {
    const [work, talk] = activityFrom(
      [
        {
          id: "h1",
          workspace_id: "ws_new",
          title: "T",
          state: "working",
          updated_at: "2026-10-02T00:00:00Z",
          created_at: "2026-10-02T00:00:00Z",
          runs: [],
          artifacts: [],
          needs_review_artifact_ids: [],
        } as never,
      ],
      [
        {
          id: "c1",
          title: "C",
          state: "open",
          created_at: "2026-10-01T00:00:00Z",
        } as never,
      ],
      "ws_new",
    );
    expect(work!.href).toBe("/assignments/h1?workspace=ws_new");
    expect(talk!.href).toBe("/conversations/c1?workspace=ws_new");
  });
});

describe("which workspace a record page reads from", () => {
  const base = { workspaces: [old, fresh], fallback: old, loading: false };
  it("the one its address names, whatever order the server lists them in", () => {
    expect(resolveScope({ ...base, named: "ws_new" })).toEqual({
      workspace: fresh,
      status: "ready",
    });
    expect(
      resolveScope({
        ...base,
        workspaces: [fresh, old],
        fallback: fresh,
        named: "ws_new",
      }).workspace,
    ).toBe(fresh);
  });
  it("one this person can't open is not available, never another instead", () => {
    expect(resolveScope({ ...base, named: "ws_gone" })).toEqual({
      workspace: null,
      status: "unavailable",
    });
  });
  it("an address naming none keeps its earlier meaning", () => {
    expect(resolveScope({ ...base, named: null }).workspace).toBe(old);
  });
  it("nothing is decided while loading, and an unreadable list is said so", () => {
    expect(
      resolveScope({ ...base, named: "ws_new", loading: true }).status,
    ).toBe("loading");
    expect(
      resolveScope({ ...base, named: "ws_new", failed: true }).status,
    ).toBe("unreadable");
  });
});
