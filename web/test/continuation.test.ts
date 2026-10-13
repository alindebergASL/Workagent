import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import examples from "../../contracts/examples.json";
import { conversationDetail } from "../src/lib/client/real-api";
import { RuntimeRequest } from "../src/components/TurnProgress";
import { responsibilityView } from "../src/lib/responsibility-view";
import type { components } from "../../contracts/src/client";

type S = components["schemas"];
type Detail = Parameters<typeof conversationDetail>[0];
const example = examples.operations.get_conversation.response as Detail;
const origin: S["ResponsibilityOrigin"] = {
  kind: "responsibility_wake",
  assignment_id: "asg-1",
  wake_id: "wake-1",
  work_version: 3,
};

/** A human turn, then a runtime continuation in the given reported state. */
function withWake(state: S["TurnState"]["state"]): Detail {
  const human = example.messages[0]!;
  const run = example.runs[0]!;
  return {
    ...example,
    messages: [
      ...example.messages,
      {
        ...human,
        id: "msg-wake",
        run_id: "run-wake",
        sequence: 99,
        author_kind: "system",
        evidence_origin: "runtime",
        text: "Continue the hand-over: confirm the room booking.",
        responsibility_origin: origin,
      },
    ],
    runs: [...example.runs, { ...run, id: "run-wake" }],
    turns: [
      ...(example.turns ?? []),
      {
        run_id: "run-wake",
        state,
        reason: `Continuation ${state}`,
        profile: "general-responses-v1",
        evidence_origin: "unverified",
        provider_observation: "not_observed",
        responsibility_origin: origin,
      },
    ],
  };
}

describe("runtime continuation requests (F1)", () => {
  for (const state of [
    "queued",
    "responding",
    "failed",
    "unavailable",
    "outcome_unknown",
    "cancelled",
    "replied",
  ] as const) {
    it(`a ${state} continuation is the runtime's, anchored to its own request`, () => {
      const d = conversationDetail(withWake(state));
      const wake = d.messages.find((m) => m.id === "msg-wake")!;
      expect(wake.author).toBe("runtime");
      expect(wake.origin).toBe("runtime");
      expect(wake.responsibility_origin).toEqual(origin);
      const turn = d.turns.find((t) => t.run_id === "run-wake")!;
      // Never the person's earlier message.
      expect(turn.message_id).toBe("msg-wake");
      expect(turn.responsibility_origin).toEqual(origin);
      expect(turn.reason).toBe(`Continuation ${state}`);
      // The person's own turn keeps its own anchor.
      const human = d.messages.find((m) => m.author === "person")!;
      const own = d.turns.find((t) => t.run_id === human.run_id)!;
      expect(own.message_id).toBe(human.id);
    });
  }
  it("renders as Workagent's request, never as 'You'", () => {
    const html = renderToStaticMarkup(
      createElement(RuntimeRequest, { text: "Confirm the room.", origin }),
    );
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/You:/);
    expect(text).toContain("Continuation request from a hand-over");
    expect(text).toContain("not by you");
    expect(text).toContain("Wake wake-1 · hand-over version 3");
    expect(html).toContain('href="/assignments/asg-1"');
  });
});

describe("execution status, claiming no more than recorded (F2)", () => {
  const life = (
    execution_status: S["ResponsibilityLifecycle"]["execution_status"],
    run_id: string | null = null,
  ): S["ResponsibilityLifecycle"] => ({
    schema_version: "responsibility/v1",
    state: "active",
    current_outcome: "Outline saved.",
    next_action: { kind: "continue_work", description: "Draft the agenda." },
    conversation_work_version: 2,
    execution_status,
    run_id,
    outcome_status: "unverified",
    review_required: false,
    check_in_due: false,
    wake_status: "none",
  });
  it("queued isn't started; running isn't done", () => {
    expect(responsibilityView(life("queued")).execution).toMatch(
      /Queued isn’t the same as started/,
    );
    expect(responsibilityView(life("running", "run-9")).execution).toMatch(
      /Running isn’t the same as done/,
    );
    expect(responsibilityView(life("running", "run-9")).runId).toBe("run-9");
  });
  it("settled isn't accepted or complete; blocked may have done work", () => {
    const settled = responsibilityView(life("settled", "run-9")).execution;
    expect(settled).toMatch(/isn’t accepted/);
    expect(settled).toMatch(/goal isn’t marked done/);
    expect(responsibilityView(life("blocked")).execution).toMatch(
      /Some work may already have happened/,
    );
  });
  it("not admitted is about now, not a claim it can never run", () => {
    const v = responsibilityView(life("not_admitted")).execution;
    expect(v).toMatch(/right now/);
    expect(v).not.toMatch(/can’t|never|on my own yet/);
  });
});
