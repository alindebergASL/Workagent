/**
 * The responsibility page's "Agent's latest recorded note": its text and its
 * time always come from the same snapshot observation, matched by
 * assignment; otherwise the record's own text with an unknown time.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LatestNote } from "@/components/LatestNote";
import { parseWorkSnapshot } from "@/lib/contract/work-events";
import { latestNote, type SnapshotRead } from "@/lib/latest-note";

const RECORD = "Prepared the venue shortlist and asked about dates.";
const ready = (
  responsibility: {
    assignment_id: string;
    historical_observation: { text: string; observed_at: string | null } | null;
  }[],
): SnapshotRead => ({
  kind: "ready",
  snapshot: parseWorkSnapshot({
    schema_version: "workagent/work-v1",
    conversation_id: "c1",
    work_version: 4,
    access_generation: 1,
    // When the snapshot was read; never when a note was written.
    checked_at: "2026-10-28T12:00:00Z",
    snapshot_cursor: "c",
    execution: { state: "unknown", run_id: null },
    responsibility: responsibility.map((r) => ({
      ...r,
      state: "active",
      next_action: { kind: "continue_work", description: "Keep going" },
      next_check_in_at: null,
      review_required: false,
    })),
    artifacts: [],
    pending_proposals: [],
  }),
});
const html = (read: SnapshotRead, outcome = RECORD) => {
  const note = latestNote(outcome, "a1", read);
  return note
    ? renderToStaticMarkup(createElement(LatestNote, { note, zone: "UTC" }))
    : "";
};

describe("agent's latest recorded note", () => {
  it("known time: the matching observation's text with its own time", () => {
    const read = ready([
      {
        assignment_id: "a1",
        historical_observation: {
          text: "Shortlisted three venues.",
          observed_at: "2026-10-25T08:00:00Z",
        },
      },
    ]);
    expect(latestNote(RECORD, "a1", read)).toEqual({
      text: "Shortlisted three venues.",
      time: { kind: "known", at: "2026-10-25T08:00:00Z" },
    });
    const out = html(read);
    expect(out).toContain("Agent’s latest recorded note");
    expect(out).toContain('data-time="known"');
    expect(out).toContain("Shortlisted three venues.");
    expect(out).not.toContain("time not recorded");
    // The record's other text never borrows the observation's time.
    expect(out).not.toContain(RECORD);
  });

  it("unknown time: an observation recorded without a time says so", () => {
    const read = ready([
      {
        assignment_id: "a1",
        historical_observation: { text: "Imported note.", observed_at: null },
      },
    ]);
    expect(latestNote(RECORD, "a1", read)).toEqual({
      text: "Imported note.",
      time: { kind: "unknown" },
    });
    const out = html(read);
    expect(out).toContain("Agent’s latest recorded note");
    expect(out).toContain("time not recorded");
    // The snapshot's read time is not offered as when it was written.
    expect(out).not.toMatch(/12:00/);
  });

  it("mismatched: another responsibility's observation lends neither text nor time", () => {
    const read = ready([
      {
        assignment_id: "a2",
        historical_observation: {
          text: "Someone else's note.",
          observed_at: "2026-10-25T08:00:00Z",
        },
      },
    ]);
    expect(latestNote(RECORD, "a1", read)).toEqual({
      text: RECORD,
      time: { kind: "unknown" },
    });
    const out = html(read);
    expect(out).toContain(RECORD);
    expect(out).toContain("time not recorded");
    expect(out).not.toContain("Someone else");
  });

  it("matching responsibility with no observation keeps the record's text, time unknown", () => {
    const read = ready([{ assignment_id: "a1", historical_observation: null }]);
    expect(latestNote(RECORD, "a1", read)).toEqual({
      text: RECORD,
      time: { kind: "unknown" },
    });
  });

  it("unavailable snapshot: the record's text stays, with an unknown time", () => {
    expect(latestNote(RECORD, "a1", { kind: "unavailable" })).toEqual({
      text: RECORD,
      time: { kind: "unknown" },
    });
    const out = html({ kind: "unavailable" });
    expect(out).toContain(RECORD);
    expect(out).toContain("time not recorded");
  });

  it("while the snapshot is read, the note shows with no time claimed yet", () => {
    expect(latestNote(RECORD, "a1", { kind: "loading" })?.time).toEqual({
      kind: "checking",
    });
    const out = html({ kind: "loading" });
    expect(out).toContain(RECORD);
    expect(out).not.toContain("latest-note-time");
    expect(out).not.toContain("time not recorded");
  });

  it("no note at all renders nothing", () => {
    expect(latestNote("  ", "a1", { kind: "unavailable" })).toBeNull();
    expect(
      latestNote(
        "",
        "a1",
        ready([
          {
            assignment_id: "a1",
            historical_observation: { text: " ", observed_at: null },
          },
        ]),
      ),
    ).toBeNull();
  });
});
