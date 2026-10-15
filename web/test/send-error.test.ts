import { describe, expect, it } from "vitest";
import { ApiError, describeSendError } from "@/lib/contract/errors";

const err = (code: ConstructorParameters<typeof ApiError>[0]["code"]) =>
  new ApiError({ code, status: 422, message: "Operation cannot proceed." });

describe("describeSendError", () => {
  it("explains a send refused where answers aren't turned on, keeping the draft", () => {
    for (const activation of [undefined, "disabled"] as const) {
      const d = describeSendError(err("unsupported_operation"), activation);
      expect(d.title).toBe("Workagent isn’t set up to answer here yet");
      expect(d.nextAction).toContain("Nothing was sent");
      expect(d.nextAction).toContain("kept");
      expect(`${d.title} ${d.nextAction}`).not.toMatch(/Operation cannot/);
    }
  });

  it("says answers are turned off when the activation was revoked", () => {
    for (const code of ["unsupported_operation", "action_unresolved"] as const)
      expect(describeSendError(err(code), "revoked").title).toBe(
        "Answers are turned off for this conversation",
      );
  });

  it("doesn't claim answers are off where they're on", () => {
    const d = describeSendError(err("unsupported_operation"), "active");
    expect(d.title).toBe("This message can’t be sent in this conversation");
  });

  it("names an unsettled earlier send rather than the raw service text", () => {
    const d = describeSendError(err("action_unresolved"), "active");
    expect(d.title).toBe("An earlier request here hasn’t been resolved");
  });

  it("leaves every other error to the general copy", () => {
    const e = err("version_conflict");
    expect(describeSendError(e, "disabled").title).toBe(
      "A newer saved version exists",
    );
  });
});
