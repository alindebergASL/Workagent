import { describe, expect, it } from "vitest";
import type { components } from "../../contracts/src/client";
import type { ConversationDetailView } from "../src/lib/contract/types";
import type { HoldEntry } from "../src/lib/client/responsibility";
import {
  actionable,
  canAskAbout,
  leadWork,
  outdated,
  proposalSummary,
  spaceStanding,
  workKind,
  workTitle,
  type SpaceWorkItem,
} from "../src/lib/space-view";

type S = components["schemas"];

const detail = (
  over: Partial<ConversationDetailView> = {},
): ConversationDetailView =>
  ({
    conversation: {
      id: "cv1",
      title: "Autumn workshop",
      state: "open",
      work_version: 3,
      work_area: {
        title: "Autumn workshop",
        goal: "Run a two-day workshop for 40 people in October.",
        kind: "project",
        origin: "human",
      },
    },
    messages: [],
    turns: [],
    artifact_ids: [],
    assignment_ids: [],
    ...over,
  }) as unknown as ConversationDetailView;

const work = (
  id: string,
  title: string,
  at: string,
  pending = 0,
  body: Record<string, unknown> = { title, blocks: [] },
): SpaceWorkItem => ({
  artifact: {
    id,
    current_revision_id: `${id}-r`,
    current_revision: {
      id: `${id}-r`,
      body: { ...body, title },
      body_hash: "0".repeat(64),
      created_at: at,
      revision_number: 1,
      author_kind: "worker",
    },
  } as unknown as S["Artifact"],
  pending: Array.from(
    { length: pending },
    (_, i) =>
      ({
        id: `${id}-p${i}`,
        status: "pending",
        base_revision_id: `${id}-r`,
      }) as S["Proposal"],
  ),
});

const life = (over: Partial<S["ResponsibilityLifecycle"]>) =>
  ({
    schema_version: "responsibility/v1",
    state: "active",
    current_outcome: "Recorded.",
    next_action: { kind: "continue_work", description: "Draft." },
    conversation_work_version: 2,
    execution_status: "not_admitted",
    outcome_status: "unverified",
    review_required: false,
    check_in_due: false,
    wake_status: "none",
    ...over,
  }) as S["ResponsibilityLifecycle"];
const ready = (
  goal: string,
  l: Partial<S["ResponsibilityLifecycle"]> = {},
): HoldEntry => ({
  kind: "ready",
  stale: false,
  detail: {
    assignment: { goal } as S["Assignment"],
    lifecycle: life(l),
  } as S["ResponsibilityDetail"],
});
const turn = (state: string) =>
  ({ run_id: "r1", message_id: "m1", state }) as never;

describe("where a project stands", () => {
  it("with nothing yet, invites the first request and claims no progress", () => {
    const s = spaceStanding({ detail: detail(), work: [], holds: {} });
    expect(s.next.text).toMatch(/what you need for this project/);
    expect(s.needs).toEqual([]);
    expect(s.underway).toEqual([]);
  });

  it("a proposed change comes first and links to where it's reviewed", () => {
    const s = spaceStanding({
      detail: detail({ artifact_ids: ["a", "b"], assignment_ids: ["h"] }),
      work: [
        work("a", "Venue budget", "2026-10-01T10:00:00Z"),
        work("b", "Run sheet", "2026-10-02T10:00:00Z", 1),
      ],
      holds: { h: ready("Confirm the caterer", { state: "waiting_person" }) },
    });
    expect(s.next.text).toBe(
      "A change to “Run sheet” is waiting for your review.",
    );
    expect(s.next.href).toBe("/conversations/cv1/artifacts/b");
    expect(s.needs.map((l) => l.key)).toEqual(["review:b", "hold:h"]);
  });

  it("a proposal made for an earlier version is outdated, not a change to apply", () => {
    const item = work("b", "Run sheet", "2026-10-02T10:00:00Z", 1);
    item.pending[0] = { ...item.pending[0]!, base_revision_id: "older" };
    const s = spaceStanding({
      detail: detail({ artifact_ids: ["b"] }),
      work: [item],
      holds: {},
    });
    expect(s.next.key).toBe("outdated:b");
    expect(s.next.text).toMatch(
      /earlier version, so it can’t be applied as is/,
    );
    expect(s.needs.some((l) => l.key === "review:b")).toBe(false);
    expect(actionable(item)).toEqual([]);
    expect(outdated(item)).toHaveLength(1);
  });

  it("responsibilities follow their current lifecycle: waiting needs you, active is held, not running", () => {
    const s = spaceStanding({
      detail: detail({ assignment_ids: ["w", "a"] }),
      work: [],
      holds: {
        w: ready("Chase the venue contract", { state: "waiting_person" }),
        a: ready("Keep the rota current"),
      },
    });
    expect(s.needs).toHaveLength(1);
    expect(s.needs[0]!.text).toMatch(/Chase the venue contract/);
    expect(s.next.key).toBe("hold:w");
    expect(s.underway[0]!.text).toMatch(/Keep the rota current/);
    expect(s.underway[0]!.detail).toMatch(
      /^Next: Draft\. Nothing runs for it right now/,
    );
    expect(s.underway[0]!.text + s.underway[0]!.detail).not.toMatch(
      /Running|Working on/,
    );
  });

  it("an unreadable responsibility is said as such, never as nothing", () => {
    const s = spaceStanding({
      detail: detail({ assignment_ids: ["u"] }),
      work: [],
      holds: { u: { kind: "unknown", lastAbsent: false } },
    });
    expect(s.underway[0]!.text).toMatch(/Couldn’t check/);
  });

  it("a reply in progress needs nothing from the person", () => {
    const s = spaceStanding({
      detail: detail({ turns: [turn("responding")] }),
      work: [],
      holds: {},
    });
    expect(s.next.text).toMatch(/Nothing needs you while Workagent replies/);
    expect(s.underway[0]!.text).toMatch(/replying to your latest message/);
  });

  it("an unconfirmed outcome says it isn’t resent, not to ask again", () => {
    const s = spaceStanding({
      detail: detail({ turns: [turn("outcome_unknown")] }),
      work: [],
      holds: {},
    });
    expect(s.next.tone).toBe("attention");
    expect(s.next.text).toMatch(/won’t be sent again on its own/);
  });

  it("a turn that kept a result isn't called incomplete; one that didn't is", () => {
    const failed = (progress?: unknown) =>
      ({ run_id: "r1", state: "failed", progress }) as never;
    const kept = spaceStanding({
      detail: detail({
        turns: [failed({ retained_local_result: { status: "reply" } })],
      }),
      work: [],
      holds: {},
    });
    expect(kept.needs).toEqual([]);
    const lost = spaceStanding({
      detail: detail({ turns: [failed()] }),
      work: [],
      holds: {},
    });
    expect(lost.next.text).toMatch(/didn’t complete/);
  });

  it("a responsibility marked for review needs the person and says so", () => {
    const s = spaceStanding({
      detail: detail({ assignment_ids: ["v"] }),
      work: [],
      holds: {
        v: ready("Chase the venue", {
          review_required: true,
          outcome_status: "needs_review",
        }),
      },
    });
    expect(s.next.key).toBe("hold:v");
    expect(s.next.detail).toMatch(/^Needs your review before it continues/);
  });

  it("while its work is still being read, a project isn't called empty", () => {
    const s = spaceStanding({
      detail: detail({ artifact_ids: ["a"] }),
      work: null,
      holds: {},
    });
    expect(s.next.text).toMatch(/Checking where/);
    expect(s.next.text).not.toMatch(/get started/);
  });

  it("unreadable work is said plainly, not as an empty project", () => {
    const s = spaceStanding({
      detail: detail({ artifact_ids: ["a"] }),
      work: null,
      workUnreadable: true,
      holds: {},
    });
    expect(s.next.text).toMatch(/Couldn’t read this project’s work/);
  });

  it("with saved work and nothing pending, the next step is to continue it", () => {
    const s = spaceStanding({
      detail: detail({ artifact_ids: ["a", "b"] }),
      work: [
        work("a", "Venue budget", "2026-10-03T10:00:00Z"),
        work("b", "Run sheet", "2026-10-02T10:00:00Z"),
      ],
      holds: {},
    });
    expect(s.next.text).toBe(
      "Continue with “Venue budget”, or ask for a change.",
    );
  });
});

describe("the work shown first", () => {
  it("prefers work with a change to review, then the most recently changed", () => {
    const a = work("a", "A", "2026-10-03T10:00:00Z");
    const b = work("b", "B", "2026-10-01T10:00:00Z", 2);
    const c = work("c", "C", "2026-10-04T10:00:00Z");
    expect(leadWork([a, b, c])!.artifact.id).toBe("b");
    expect(leadWork([a, c])!.artifact.id).toBe("c");
    expect(leadWork([])).toBeNull();
  });
  it("names work by its own title and kind", () => {
    expect(workTitle(work("a", "  ", "x").artifact)).toBe("Untitled work");
    expect(workKind(work("a", "T", "x").artifact)).toBe("Document");
    expect(
      workKind(
        work("t", "Rates", "x", 0, {
          kind: "table",
          columns: [],
          rows: [],
        }).artifact,
      ),
    ).toBe("Table");
  });
});

describe("what a proposed change does", () => {
  const field = (key: string) => ({ key, label: key, type: "text" });
  const tbl = (rows: [string, string][]) =>
    ({
      kind: "structured_table",
      fields: [field("item"), field("cost")],
      rows: rows.map(([id, item]) => ({
        row_id: id,
        cells: [
          { field_key: "item", value: item },
          { field_key: "cost", value: "1" },
        ],
      })),
    }) as never;
  it("names an added row from the table itself", () => {
    expect(
      proposalSummary(
        tbl([["a", "Venue"]]),
        tbl([
          ["a", "Venue"],
          ["b", "Catering"],
        ]),
      ),
    ).toBe("It adds a row: Catering.");
  });
  it("counts changed and removed rows", () => {
    expect(
      proposalSummary(
        tbl([
          ["a", "Venue"],
          ["b", "Catering"],
        ]),
        tbl([["a", "Venue hire"]]),
      ),
    ).toBe("It changes 1 row and removes 1 row.");
  });
  it("describes document changes by part, and says nothing when it can't", () => {
    const doc = (blocks: [string, string][]) =>
      ({
        blocks: blocks.map(([block_id, text]) => ({ block_id, text })),
      }) as never;
    expect(
      proposalSummary(
        doc([["1", "a"]]),
        doc([
          ["1", "b"],
          ["2", "c"],
        ]),
      ),
    ).toBe("It rewrites 1 part and adds 1 part.");
    expect(proposalSummary(doc([["1", "a"]]), tbl([]))).toBeNull();
  });
});

describe("what a reply can name as its subject", () => {
  it("accepts the kinds the service targets, never a saved file", () => {
    const of = (body: Record<string, unknown>) =>
      work("x", "T", "x", 0, body).artifact;
    expect(canAskAbout(of({ blocks: [] }))).toBe(true);
    expect(canAskAbout(of({ kind: "structured_table", rows: [] }))).toBe(true);
    expect(canAskAbout(of({ kind: "custom_view" }))).toBe(true);
    expect(canAskAbout(of({ kind: "table", columns: [], rows: [] }))).toBe(
      true,
    );
    expect(canAskAbout(of({ kind: "tool", code: "" }))).toBe(true);
    expect(canAskAbout(of({ kind: "file", content: "x" }))).toBe(false);
  });
});
