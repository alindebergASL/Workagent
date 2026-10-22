import { describe, expect, it } from "vitest";
import type { components } from "../../contracts/src/client";
import { responsibilityView } from "../src/lib/responsibility-view";

type Lifecycle = components["schemas"]["ResponsibilityLifecycle"];
const life = (over: Partial<Lifecycle> = {}): Lifecycle => ({
  schema_version: "responsibility/v1",
  state: "active",
  current_outcome: "A draft plan is saved.",
  next_action: { kind: "continue_work", description: "Draft the agenda." },
  conversation_work_version: 3,
  execution_status: "not_admitted",
  outcome_status: "unverified",
  review_required: false,
  check_in_due: false,
  wake_status: "none",
  ...over,
});

describe("a recorded responsibility, in plain words", () => {
  it("never implies work is running while execution isn't admitted", () => {
    const v = responsibilityView(life());
    expect(v.state).toBe("Recorded as yours to carry forward");
    expect(v.execution).toBe("Nothing is running for it right now.");
    expect(v.executionDetail).toMatch(/hasn’t been admitted to run/);
    expect(v.execution).not.toMatch(/can’t|never/);
    expect(v.next).toBe("Draft the agenda.");
    expect(v.allowed).toEqual(["pause", "cancel", "takeover"]);
  });
  it("says what it waits on, what changed and what needs review", () => {
    const v = responsibilityView(
      life({
        state: "waiting_person",
        wait: { kind: "person", reason: "Asha to confirm the room." },
        observations: [
          {
            kind: "artifact_revision",
            object_id: "a",
            expected_version: "r1",
            observed_version: "r2",
            content_hash: "h",
            changed: true,
          },
        ],
        review_required: true,
        wake_status: "queued",
      }),
    );
    expect(v.waiting).toBe("Asha to confirm the room.");
    expect(v.lines).toEqual([
      "1 thing it depends on changed since it was recorded.",
    ]);
    expect(v.needsYou).toBe("Your review of its result.");
    expect(v.reviewQueued).toBe(true);
  });
  it("a paused one can resume; a stopped or taken-back one offers nothing", () => {
    expect(responsibilityView(life({ state: "paused" })).allowed).toEqual([
      "resume",
      "cancel",
      "takeover",
    ]);
    for (const state of ["cancelled", "taken_over"] as const) {
      const v = responsibilityView(life({ state, wake_status: "queued" }));
      expect(v.allowed).toEqual([]);
      expect(v.execution).toBe(
        state === "taken_over"
          ? "It’s back with you. Workagent isn’t holding it any more."
          : "Stopped. Nothing further runs for it.",
      );
      expect(v.reviewQueued).toBe(false);
      expect(v.next).toBeNull();
    }
  });
  it("a decision it asks for is what it needs from you, said once", () => {
    const v = responsibilityView(
      life({
        state: "waiting_person",
        next_action: {
          kind: "request_decision",
          description: "Choose the Tuesday or Thursday slot.",
        },
      }),
    );
    expect(v.needsYou).toBe("Choose the Tuesday or Thursday slot.");
    expect(v.next).toBeNull();
    // A review still comes first, and then the decision is its next step.
    const r = responsibilityView(
      life({
        review_required: true,
        next_action: { kind: "request_decision", description: "Choose." },
      }),
    );
    expect(r.needsYou).toBe("Your review of its result.");
    expect(r.next).toBe("Choose.");
  });
  it("names a blocker plainly", () => {
    expect(
      responsibilityView(life({ state: "blocked", blocker: "grant_required" }))
        .needsYou,
    ).toBe("It needs a permission that hasn’t been granted.");
  });
});

describe("what it's doing, in one line", () => {
  it("says Workagent is on it only while a run is queued or running", () => {
    expect(
      responsibilityView(life({ execution_status: "running" })).state,
    ).toBe("Workagent is on it");
    expect(responsibilityView(life({ execution_status: "queued" })).state).toBe(
      "Workagent is on it",
    );
    expect(responsibilityView(life()).state).toBe(
      "Recorded as yours to carry forward",
    );
    expect(
      responsibilityView(life({ state: "paused", execution_status: "queued" }))
        .state,
    ).toBe("Paused");
    // A finished run needs the person: its result isn't accepted.
    expect(
      responsibilityView(life({ execution_status: "settled" })).needsYou,
    ).toBe("Your review of its result.");
  });
});
