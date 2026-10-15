import { describe, expect, it } from "vitest";
import type { components } from "../../contracts/src/client";
import recorded from "./fixtures/recording-turn.json";
import {
  recordedResponsibilities,
  turnProgress,
  type RecordingReceipt,
} from "../src/lib/contract/natural";
import {
  adaptivePresentation,
  hasProductOutput,
} from "../src/lib/adaptive-presentation";
import { holdGroup, holdStatus } from "../src/lib/hold-view";
import type { HoldEntry } from "../src/lib/client/responsibility";

type S = components["schemas"];
// A recording-only turn exactly as the backend returned it (synthetic
// provider transport): a saved responsibility, no product output.
const turn = recorded as unknown as S["TurnState"];

const receipt = (id: string, state: RecordingReceipt["state"] = "active") =>
  ({
    kind: "record_responsibility",
    version: "1",
    assignment_id: id,
    conversation_id: "c",
    owner_id: "local-human",
    work_version: 2,
    state,
    outcome_status: "unverified",
    execution_status: "not_admitted",
  }) as RecordingReceipt;

describe("recording receipts", () => {
  it("keeps the turn's receipt and each step's, one per assignment", () => {
    const progress = turnProgress(turn)!;
    expect(progress.responsibility_recording?.assignment_id).toBe(
      turn.responsibility_recording!.assignment_id,
    );
    // The turn receipt and the step's mutation result name one assignment.
    expect(recordedResponsibilities(progress)).toHaveLength(1);
    expect(recordedResponsibilities(progress)[0]!.state).toBe("waiting_person");
  });
  it("is empty without a receipt, and never read from reply text", () => {
    expect(recordedResponsibilities(undefined)).toEqual([]);
    expect(
      recordedResponsibilities(
        turnProgress({
          ...turn,
          responsibility_recording: null,
          adaptive: null,
        }),
      ),
    ).toEqual([]);
  });
  it("lists two different obligations separately", () => {
    const progress = {
      responsibility_recording: receipt("a"),
      adaptive: {
        ...turn.adaptive!,
        steps: [
          { ...turn.adaptive!.steps![0]!, mutation_result: receipt("a") },
          { ...turn.adaptive!.steps![0]!, mutation_result: receipt("b") },
        ],
      },
    } as Parameters<typeof recordedResponsibilities>[0];
    expect(
      recordedResponsibilities(progress).map((r) => r.assignment_id),
    ).toEqual(["a", "b"]);
  });
});

describe("a recording is not a calculation", () => {
  it("a recording-only turn says a responsibility was recorded", () => {
    const progress = turnProgress(turn)!;
    expect(hasProductOutput(progress.retained_local_result)).toBe(false);
    const view = adaptivePresentation("replied", progress)!;
    expect(view.title).toBe("Responsibility recorded");
    expect(view.note).not.toMatch(/calculat|not saved as work/i);
    expect(view.note).toMatch(/At recording, the outcome wasn’t verified/);
    expect(view.note).toMatch(/current responsibility/);
    expect(view.note).not.toMatch(/Workagent holds|nothing runs for it yet/);
  });
  it("still says so when the final explanation never arrived", () => {
    const progress = turnProgress({ ...turn, explanation: null })!;
    expect(adaptivePresentation("replied", progress)!.title).toBe(
      "Responsibility recorded",
    );
    expect(adaptivePresentation("failed", progress)!.title).toBe(
      "Responsibility recorded",
    );
    // While the turn is still running, nothing is claimed yet.
    expect(adaptivePresentation("responding", progress)).toBeNull();
  });
  it("mixed output keeps the product result's own presentation", () => {
    const progress = turnProgress({
      ...turn,
      retained_local_result: {
        ...turn.retained_local_result!,
        status: "observed",
        output: { kind: "run_wasm", value: "3750" } as never,
      },
    })!;
    expect(hasProductOutput(progress.retained_local_result)).toBe(true);
    expect(adaptivePresentation("replied", progress)?.title).not.toBe(
      "Responsibility recorded",
    );
  });
});

const life = (
  over: Partial<S["ResponsibilityLifecycle"]> = {},
): S["ResponsibilityLifecycle"] =>
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
  l: Partial<S["ResponsibilityLifecycle"]>,
  stale = false,
): HoldEntry => ({
  kind: "ready",
  stale,
  detail: {
    assignment: { goal: "Prepare the rota" } as S["Assignment"],
    lifecycle: life(l),
  } as S["ResponsibilityDetail"],
});

describe("where a hand-over stands, on every list", () => {
  it("active is held, not running; settled needs review, not done", () => {
    const active = holdStatus(ready({}))!;
    expect(active.label).toBe("Recorded as yours to carry forward");
    expect(active.note).toMatch(/Nothing runs for it right now/);
    expect(active.label + active.note).not.toMatch(/Running|Working|Done/);
    expect(holdGroup(ready({}))).toBe("holding");
    const settled = holdStatus(ready({ execution_status: "settled" }))!;
    expect(settled.note).toMatch(/needs your review/);
    expect(holdGroup(ready({ execution_status: "settled" }))).toBe("attention");
    expect(holdStatus(ready({ execution_status: "running" }))!.note).toMatch(
      /in progress; not done/,
    );
  });
  it("waiting for a person needs attention; closed is closed", () => {
    expect(holdGroup(ready({ state: "waiting_person" }))).toBe("attention");
    expect(holdGroup(ready({ state: "taken_over" }))).toBe("closed");
    expect(holdGroup(ready({ state: "cancelled" }))).toBe("closed");
    expect(holdStatus(ready({ state: "taken_over" }))!.label).toBe(
      "You took this back",
    );
  });
  it("a canonical pause is the record's, not the coarse state", () => {
    expect(holdStatus(ready({ state: "paused" }))!.label).toBe("Paused");
    expect(holdGroup(ready({ state: "paused" }))).toBe("holding");
  });
  it("stale, denied, unknown and absent are said as such", () => {
    expect(holdStatus(ready({}, true))!.note).toMatch(/^Last read only/);
    expect(holdStatus({ kind: "denied" })!.label).toBe("Not available");
    expect(holdStatus({ kind: "unknown", lastAbsent: true })!.note).toMatch(
      /may have changed/,
    );
    expect(holdStatus({ kind: "unknown", lastAbsent: false })!.label).toBe(
      "Couldn’t check",
    );
    expect(
      holdStatus({
        kind: "absent",
        assignment: { state: "paused" } as S["Assignment"],
      })!.label,
    ).toBe("Paused hand-over");
    expect(holdGroup({ kind: "denied" })).toBeNull();
    expect(holdGroup(undefined)).toBeNull();
  });
});
