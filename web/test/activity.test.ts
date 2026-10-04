import { describe, expect, it } from "vitest";
import { activityFrom, dayLabel } from "../src/lib/activity";
import type {
  AssignmentSummary,
  ConversationSummary,
} from "../src/lib/contract/types";

const work = (id: string, at: string, extra: Partial<AssignmentSummary> = {}) =>
  ({
    id,
    workspace_id: "w",
    title: `Work ${id}. More detail.`,
    goal: "g",
    state: "ready_for_review",
    work_revision: 1,
    stage: null,
    created_at: at,
    updated_at: at,
    observed_at: at,
    latest_result: null,
    next_step: null,
    needs_review_artifact_ids: [],
    selected_source_count: 1,
    ...extra,
  }) as AssignmentSummary;
const convo = (id: string, at: string, state: "open" | "cancelled" = "open") =>
  ({
    id,
    title: `Talk ${id}`,
    state,
    work_version: 1,
    created_at: at,
    context_count: 0,
  }) as ConversationSummary;

describe("activity from recorded state", () => {
  it("merges work and conversations, latest change first", () => {
    const items = activityFrom(
      [work("a", "2026-10-03T10:00:00Z"), work("b", "2026-10-03T12:00:00Z")],
      [convo("c", "2026-10-03T11:00:00Z", "cancelled")],
    );
    expect(items.map((i) => i.id)).toEqual([
      "work:b",
      "conversation:c",
      "work:a",
    ]);
    expect(items[0]).toMatchObject({
      title: "Work b",
      status: "Ready for review",
      href: "/assignments/b",
    });
    expect(items[1]).toMatchObject({
      status: "Conversation ended",
      href: "/conversations/c",
    });
  });

  it("sends a waiting decision straight to the document", () => {
    const [i] = activityFrom(
      [
        work("d", "2026-10-03T10:00:00Z", {
          needs_review_artifact_ids: ["art"],
        }),
      ],
      [],
    );
    expect(i).toMatchObject({
      status: "Decision needed",
      href: "/assignments/d/artifacts/art",
    });
  });

  it("labels a recorded hand-over truthfully", () => {
    const [i] = activityFrom(
      [
        work("h", "2026-10-03T10:00:00Z", {
          lifecycle: "paused",
          conversation_id: "c",
          state: "needs_input",
        }),
      ],
      [],
    );
    expect(i!.status).toBe("Handed over · not started");
  });

  it("groups by day in the display zone", () => {
    const now = new Date("2026-10-04T09:00:00Z");
    expect(dayLabel("2026-10-04T01:00:00Z", "UTC", now)).toBe("Today");
    expect(dayLabel("2026-10-03T23:00:00Z", "UTC", now)).toBe("Yesterday");
    expect(dayLabel("2026-10-01T12:00:00Z", "UTC", now)).toBe("Thu 1 Oct");
  });
});
