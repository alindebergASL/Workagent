import { describe, expect, it } from "vitest";
import type { Proposal, Revision } from "../src/lib/contract/types";
import { threadFrom } from "../src/lib/thread";

const rev = (
  id: string,
  sequence: number,
  kind: "human" | "agent",
  at: string,
): Revision => ({
  id,
  artifact_id: "a",
  parent_revision_id: null,
  sequence,
  author: { kind, name: kind === "human" ? "You" : "Workagent" },
  created_at: at,
  status: "accepted",
  body: [],
  body_hash: "",
  source_dependencies: [],
  note: null,
});
const prop = (
  id: string,
  status: Proposal["status"],
  at: string,
  reason: string,
  resolved: string | null = null,
): Proposal => ({
  id,
  artifact_id: "a",
  base_revision_id: "r1",
  base_sequence: 1,
  status,
  author: { kind: "agent", name: "Workagent" },
  reason,
  created_at: at,
  updated_at: at,
  body: null,
  body_hash: null,
  conflict: null,
  resolved_by_revision_id: resolved,
});

describe("conversation beside the work, from records only", () => {
  it("orders the request, the saved work, edits and asks with their outcomes", () => {
    const t = threadFrom({
      goal: "Help me plan the intake change.",
      goalAt: "2026-10-03T10:05:00Z", // later than the first save: the request still leads
      title: "Working plan",
      revisions: [
        rev("r1", 1, "agent", "2026-10-03T10:01:00Z"),
        rev("r2", 2, "human", "2026-10-03T10:02:00Z"),
        rev("r3", 3, "agent", "2026-10-03T10:04:00Z"),
      ],
      proposals: [
        prop("p1", "accepted", "2026-10-03T10:03:00Z", "Add an owner.", "r3"),
        prop("p2", "proposed", "2026-10-03T10:06:00Z", "Shorten it."),
      ],
    });
    expect(t.map((e) => [e.who, e.text])).toEqual([
      ["person", "Help me plan the intake change."],
      [
        "agent",
        "I prepared the working plan. Edit anything, or ask me for a change.",
      ],
      ["event", "You saved your edits as revision 2."],
      ["person", "Add an owner."],
      ["agent", "I proposed this change."],
      ["event", "You applied it as revision 3."],
      ["person", "Shorten it."],
      [
        "agent",
        "I’ve proposed this change. Nothing is applied until you decide.",
      ],
    ]);
    expect(t.at(-1)?.waiting).toBe(true);
  });

  it("quotes the person's own instruction and never invents a reply", () => {
    const t = threadFrom({
      goal: null,
      goalAt: "",
      title: "Plan",
      revisions: [],
      proposals: [
        prop("p", "generating", "2026-10-03T10:00:00Z", "Exactly this."),
      ],
    });
    expect(t[0]).toMatchObject({ who: "person", text: "Exactly this." });
    expect(t[1]?.text).toMatch(/drafting/);
    expect(t).toHaveLength(2);
  });

  it("records a kept version as the person's decision", () => {
    const t = threadFrom({
      goal: null,
      goalAt: "",
      title: "Plan",
      revisions: [],
      proposals: [prop("p", "declined", "2026-10-03T10:00:00Z", "Try this.")],
    });
    expect(t.at(-1)).toMatchObject({
      who: "event",
      text: "You kept your version. The proposal stays in history.",
    });
  });
});
