import { describe, expect, it } from "vitest";
import {
  turnExecution,
  workspaceExecution,
  type ExecutionStatus,
} from "@/lib/execution-view";

const status = (
  state: ExecutionStatus["state"],
  runs: ExecutionStatus["runs"] = [],
  can = false,
): ExecutionStatus => ({
  workspace_id: "w",
  state,
  can_advance_authorized_work: can,
  checked_at: "2026-10-15T17:00:00Z",
  last_progress_at: null,
  runs,
});

describe("a pending turn, as the service checked it", () => {
  it("says nothing without a check", () => {
    expect(turnExecution("r", null)).toBeNull();
  });
  it("is not running when there's no heartbeat, never working", () => {
    expect(turnExecution("r", status("unavailable"))?.text).toMatch(
      /isn’t running/,
    );
    expect(
      turnExecution(
        "r",
        status("unavailable", [{ run_id: "r", state: "unavailable" }]),
      ),
    ).toMatchObject({ replaces: true });
  });
  it("says why a run stopped, by category", () => {
    const t = turnExecution(
      "r",
      status("blocked", [
        {
          run_id: "r",
          state: "blocked",
          failure_category: "authority_or_budget",
        },
      ]),
    );
    expect(t).toMatchObject({ replaces: true });
    expect(t?.text).toMatch(/limit/);
  });
  it("adds to in-progress wording while waiting on the model or recovering", () => {
    expect(
      turnExecution(
        "r",
        status("awaiting_provider", [
          { run_id: "r", state: "awaiting_provider" },
        ]),
      ),
    ).toMatchObject({ replaces: false });
    expect(
      turnExecution(
        "r",
        status("recovering", [{ run_id: "r", state: "recovering" }]),
      )?.replaces,
    ).toBe(false);
  });
  it("leaves working, completed and other runs alone", () => {
    expect(
      turnExecution(
        "r",
        status("working", [{ run_id: "r", state: "working" }]),
      ),
    ).toBeNull();
    expect(turnExecution("r", status("idle", [], true))).toBeNull();
    expect(
      turnExecution("r", status("idle", [{ run_id: "x", state: "completed" }])),
    ).toBeNull();
  });
});

describe("the workspace line", () => {
  it("is silent when ready", () => {
    expect(workspaceExecution(status("idle", [], true), false)).toBeNull();
    expect(
      workspaceExecution(status("waiting_for_person", [], true), false),
    ).toBeNull();
  });
  it("says not running, and that reading and editing still work", () => {
    expect(workspaceExecution(status("unavailable"), false)?.text).toMatch(
      /isn’t running.*read and edit/,
    );
  });
  it("says it can't take new work when blocked, not when another run is", () => {
    expect(workspaceExecution(status("blocked"), false)?.state).toBe("blocked");
    expect(workspaceExecution(status("blocked", [], true), false)).toBeNull();
  });
  it("says when it couldn't check, and nothing more", () => {
    expect(workspaceExecution(null, true)?.state).toBe("unknown");
    expect(workspaceExecution(null, false)).toBeNull();
  });
  it("in a conversation, never says it's working: each request shows its own run", () => {
    for (const s of ["working", "awaiting_provider", "recovering"] as const) {
      expect(workspaceExecution(status(s, [], true), false)?.state).toBe(
        "working",
      );
      expect(workspaceExecution(status(s, [], true), false, true)).toBeNull();
    }
    // What affects every request still shows there.
    expect(workspaceExecution(status("unavailable"), false, true)?.state).toBe(
      "unavailable",
    );
    expect(workspaceExecution(null, true, true)?.state).toBe("unknown");
  });
});
