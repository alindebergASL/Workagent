import { describe, expect, it } from "vitest";
import { stopOffered } from "@/lib/batch2-view";

const snap = (
  state: string,
  run_id: string | null = "run-1",
  work_version = 7,
) => ({
  conversation_id: "cv1",
  work_version,
  execution: { run_id, state },
});
const base = {
  runId: "run-1",
  snapshotStale: false,
  conversationId: "cv1",
  conversationVersion: 7,
};

describe("Stop for a run whose worker is not observed", () => {
  it("keeps Stop for queued and responding turns as before", () => {
    for (const turnState of ["queued", "responding"])
      expect(stopOffered({ ...base, turnState, snapshot: null })).toBe(true);
  });

  it("keeps Stop when the turn reads unavailable but the canonical run is still queued", () => {
    // Real API: no consumer claim observed, run waiting for a worker.
    expect(
      stopOffered({
        ...base,
        turnState: "unavailable",
        snapshot: snap("queued"),
      }),
    ).toBe(true);
    for (const s of ["running", "awaiting_provider", "recovering", "stale"])
      expect(
        stopOffered({ ...base, turnState: "unavailable", snapshot: snap(s) }),
      ).toBe(true);
  });

  it("refuses stopped, settled, blocked or unknown runs", () => {
    for (const s of ["stopped", "idle", "waiting_person", "blocked", "unknown"])
      expect(
        stopOffered({ ...base, turnState: "unavailable", snapshot: snap(s) }),
      ).toBe(false);
  });

  it("refuses historical turns even while the current run is live", () => {
    for (const turnState of [
      "cancelled",
      "replied",
      "failed",
      "outcome_unknown",
    ])
      expect(
        stopOffered({ ...base, turnState, snapshot: snap("queued") }),
      ).toBe(false);
  });

  it("stays fenced to the exact run, conversation and version from a current snapshot", () => {
    const u = { ...base, turnState: "unavailable" };
    expect(stopOffered({ ...u, snapshot: null })).toBe(false);
    expect(
      stopOffered({ ...u, snapshot: snap("queued"), snapshotStale: true }),
    ).toBe(false);
    expect(stopOffered({ ...u, snapshot: snap("queued", "run-2") })).toBe(
      false,
    );
    expect(stopOffered({ ...u, snapshot: snap("queued", null) })).toBe(false);
    expect(stopOffered({ ...u, snapshot: snap("queued", "run-1", 8) })).toBe(
      false,
    );
    expect(
      stopOffered({
        ...u,
        snapshot: { ...snap("queued"), conversation_id: "cv2" },
      }),
    ).toBe(false);
  });
});
