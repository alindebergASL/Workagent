import { describe, expect, it } from "vitest";
import type { ConversationWork } from "../src/lib/client/conversation-work";
import { highWater, later, sinceYouLeft } from "../src/lib/since-you-left";

const work = (over: Partial<ConversationWork> = {}): ConversationWork => ({
  workspace_id: "ws",
  conversation_id: "cv",
  conversation_title: "Workshop",
  artifact_id: "a1",
  title: "Workshop plan",
  kind: "document",
  revision_id: "r1",
  updated_at: "2026-10-15T10:00:00Z",
  saved_by: "agent",
  decision: null,
  ...over,
});

const LEFT = "2026-10-15T12:00:00Z";

describe("since you left", () => {
  it("says nothing on a first visit", () => {
    expect(
      sinceYouLeft([work({ updated_at: "2026-10-15T13:00:00Z" })], null),
    ).toEqual([]);
  });

  it("names a proposal waiting and work Workagent saved, newest first", () => {
    const proposed = work({
      artifact_id: "a2",
      decision: {
        proposal_id: "p",
        fresh: true,
        created_at: "2026-10-15T14:00:00Z",
      },
    });
    const saved = work({ updated_at: "2026-10-15T13:00:00Z" });
    const got = sinceYouLeft([saved, proposed], LEFT);
    expect(got.map((e) => [e.work.artifact_id, e.what])).toEqual([
      ["a2", "proposed"],
      ["a1", "saved"],
    ]);
  });

  it("leaves out what's older, the person's own saves and outdated proposals", () => {
    const got = sinceYouLeft(
      [
        work({ artifact_id: "old", updated_at: "2026-10-15T11:59:59Z" }),
        work({
          artifact_id: "mine",
          saved_by: "you",
          updated_at: "2026-10-15T13:00:00Z",
        }),
        work({
          artifact_id: "stale",
          decision: {
            proposal_id: "p",
            fresh: false,
            created_at: "2026-10-15T13:00:00Z",
          },
        }),
        work({ artifact_id: "bad", updated_at: "" }),
      ],
      LEFT,
    );
    expect(got).toEqual([]);
  });

  it("a proposal from before you left is not news, even on work saved since", () => {
    const got = sinceYouLeft(
      [
        work({
          updated_at: "2026-10-15T13:00:00Z",
          decision: {
            proposal_id: "p",
            fresh: true,
            created_at: "2026-10-15T11:00:00Z",
          },
        }),
      ],
      LEFT,
    );
    expect(got).toEqual([]);
  });

  it("marks the newest service time, independent of formatting", () => {
    expect(
      highWater([
        work({ updated_at: "2026-10-15T10:00:00Z" }),
        work({
          updated_at: "2026-10-15T09:00:00Z",
          decision: {
            proposal_id: "p",
            fresh: true,
            created_at: "2026-10-15T11:00:00.000+00:00",
          },
        }),
      ]),
    ).toBe("2026-10-15T11:00:00.000+00:00");
    expect(highWater([])).toBeNull();
    expect(later("2026-10-15T11:00:00Z", "2026-10-15T10:00:00Z")).toBe(true);
    expect(later("2026-10-15T10:00:00Z", "2026-10-15T10:00:00.000Z")).toBe(
      false,
    );
    expect(later("2026-10-15T10:00:00Z", null)).toBe(true);
    expect(later(null, null)).toBe(false);
  });
});
