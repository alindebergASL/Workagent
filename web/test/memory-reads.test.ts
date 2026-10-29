import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "@/lib/contract/errors";
import { EvidencePicker, ProcedureWarnings } from "@/components/MemoryPanel";
import {
  MemoryReadFence,
  loadEvidence,
  loadRestore,
  restoreSlot,
  EVIDENCE_SLOT,
  type RestoreChooser,
} from "@/lib/client/memory-reads";
import {
  CONFIDENCE_LABEL,
  evidenceOptionText,
  isFailureOutcome,
  reviewedInference,
  type MemoryInspection,
  type MemoryRevision,
  type ProcedureEvidenceOption,
  type ProcedureEvidencePage,
} from "@/lib/memory-contract";

/**
 * B3.4a repair R2/R4/R5/C1. Drives the exact fenced loaders MemoryPanel
 * calls, with deferred responses, against a consumer that applies results
 * the way the panel does. All data are SYNTHETIC FIXTURES.
 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

const option = (
  label: string,
  over: Partial<ProcedureEvidenceOption> = {},
): ProcedureEvidenceOption => ({
  evidence: {
    kind: "human_message",
    conversation_id: "conv-fixture",
    event_id: `msg-${label}`,
    sha256: "c".repeat(64),
  },
  label,
  outcome: "human_statement",
  observed_at: "2026-10-20T10:00:00Z",
  ...over,
});
const denied = () =>
  new ApiError({
    code: "not_found_or_not_authorized",
    status: 404,
    message: "no",
  });

/** Panel-shaped consumer: the state MemoryPanel keeps for these reads. */
function consumer() {
  const fence = new MemoryReadFence();
  const st = {
    accessLost: false,
    evidence: null as ProcedureEvidenceOption[] | { error: string } | null,
    restore: {} as Record<string, RestoreChooser | undefined>,
  };
  const loseAccess = () => {
    fence.revoke();
    st.accessLost = true;
    st.evidence = null;
    st.restore = {};
  };
  const evidence = (read: () => Promise<ProcedureEvidencePage>) =>
    loadEvidence(
      fence,
      read,
      {
        loading: () => (st.evidence = null),
        loaded: (items) => (st.evidence = items),
        failed: (m) => (st.evidence = { error: m }),
        denied: loseAccess,
      },
      () => "failed",
    );
  const restore = (
    id: string,
    base: string,
    read: () => Promise<MemoryInspection>,
  ) =>
    loadRestore(
      fence,
      id,
      base,
      read,
      { set: (c) => (st.restore[id] = c), denied: loseAccess },
      () => "failed",
    );
  const close = (id: string) => {
    fence.cancel(restoreSlot(id));
    st.restore[id] = undefined;
  };
  return { fence, st, loseAccess, evidence, restore, close };
}

const rev = (id: string, over: Partial<MemoryRevision> = {}): MemoryRevision =>
  ({
    memory_id: "mem-1",
    revision_id: id,
    kind: "procedure",
    status: "superseded",
    origin: "human_reviewed",
    confidence_label: "inferred",
    content: `FIXTURE ${id}`,
    ...over,
  }) as MemoryRevision;
const inspection = (current: string, ids: string[]): MemoryInspection =>
  ({
    current: rev(current, { status: "active" }),
    revisions: [rev("v1"), rev(current, { status: "active" })],
    notice: "",
    rollback_revision_ids: ids,
  }) as MemoryInspection;

describe("R2: fenced evidence reads", () => {
  it("a late authorized response never repopulates after access loss", async () => {
    const c = consumer();
    const a = deferred<ProcedureEvidencePage>();
    c.evidence(() => a.promise);
    c.loseAccess(); // e.g. a list read was refused meanwhile
    a.resolve({ items: [option("PRIVATE OLD LABEL")] });
    await flush();
    expect(c.st.accessLost).toBe(true);
    expect(c.st.evidence).toBeNull();
  });

  it("a replaced read is dropped; only the newest applies", async () => {
    const c = consumer();
    const a = deferred<ProcedureEvidencePage>();
    const b = deferred<ProcedureEvidencePage>();
    c.evidence(() => a.promise);
    c.evidence(() => b.promise);
    b.resolve({ items: [option("new")] });
    await flush();
    a.resolve({ items: [option("old")] });
    a.reject(new Error("late"));
    await flush();
    expect(
      (c.st.evidence as ProcedureEvidenceOption[]).map((o) => o.label),
    ).toEqual(["new"]);
  });

  it("cancellation (form closed) drops success and failure alike", async () => {
    const c = consumer();
    const a = deferred<ProcedureEvidencePage>();
    const stop = c.evidence(() => a.promise);
    stop();
    a.reject(denied());
    await flush();
    expect(c.st.accessLost).toBe(false);
    expect(c.st.evidence).toBeNull();
  });

  it("an aborted read is not applied even if it resolves", async () => {
    const c = consumer();
    let signal!: AbortSignal;
    const a = deferred<ProcedureEvidencePage>();
    loadEvidence(
      c.fence,
      (s) => ((signal = s), a.promise),
      {
        loading: () => undefined,
        loaded: (i) => (c.st.evidence = i),
        failed: () => undefined,
        denied: () => undefined,
      },
      () => "",
    );
    c.fence.revoke();
    expect(signal.aborted).toBe(true);
    a.resolve({ items: [option("x")] });
    await flush();
    expect(c.st.evidence).toBeNull();
  });

  it("a denial on the read itself revokes every other read", async () => {
    const c = consumer();
    const ev = deferred<ProcedureEvidencePage>();
    const hist = deferred<MemoryInspection>();
    c.restore("mem-1", "v2", () => hist.promise);
    c.evidence(() => ev.promise);
    ev.reject(denied());
    await flush();
    hist.resolve(inspection("v2", ["v1"]));
    await flush();
    expect(c.st.accessLost).toBe(true);
    expect(c.st.restore["mem-1"]).toBeUndefined();
  });
});

describe("R2 residual: proposal boundary cancels the current read", () => {
  it("a Retry that replaced the initial read is dropped when proposing ends", async () => {
    const c = consumer();
    const first = deferred<ProcedureEvidencePage>();
    const retry = deferred<ProcedureEvidencePage>();
    c.evidence(() => first.promise); // effect's initial read
    c.evidence(() => retry.promise); // Retry replaces it
    // What the effect cleanup does at the proposal boundary:
    c.fence.cancel(EVIDENCE_SLOT);
    retry.resolve({ items: [option("late retry")] });
    first.resolve({ items: [option("late first")] });
    await flush();
    expect(c.st.evidence).toBeNull();
  });
});

describe("R2: fenced restore history", () => {
  it("a late history read can't reopen a cancelled chooser", async () => {
    const c = consumer();
    const h = deferred<MemoryInspection>();
    c.restore("mem-1", "v2", () => h.promise);
    c.close("mem-1");
    h.resolve(inspection("v2", ["v1"]));
    await flush();
    expect(c.st.restore["mem-1"]).toBeUndefined();
  });

  it("forget (slot cancelled) and scope change (revoke) drop history", async () => {
    const c = consumer();
    const h = deferred<MemoryInspection>();
    c.restore("mem-1", "v2", () => h.promise);
    c.fence.cancel(restoreSlot("mem-1")); // what dropForm does on forget
    c.st.restore["mem-1"] = undefined;
    h.resolve(inspection("v2", ["v1"]));
    await flush();
    expect(c.st.restore["mem-1"]).toBeUndefined();
  });

  it("an older chooser read never overwrites a newer one", async () => {
    const c = consumer();
    const old = deferred<MemoryInspection>();
    const fresh = deferred<MemoryInspection>();
    c.restore("mem-1", "v2", () => old.promise);
    c.restore("mem-1", "v3", () => fresh.promise);
    fresh.resolve(inspection("v3", ["v1"]));
    await flush();
    old.resolve(inspection("v2", ["v1"]));
    await flush();
    expect(c.st.restore["mem-1"]?.base).toBe("v3");
    expect(c.st.restore["mem-1"]?.targets?.map((t) => t.revision_id)).toEqual([
      "v1",
    ]);
  });

  it("R4: consumes server ids; superseded adopted v1 is offered", async () => {
    const c = consumer();
    c.restore("mem-1", "v2", async () => inspection("v2", ["v1"]));
    await flush();
    expect(c.st.restore["mem-1"]?.targets?.map((t) => t.status)).toEqual([
      "superseded",
    ]);
    c.restore("mem-1", "v2", async () => inspection("v2", []));
    await flush();
    expect(c.st.restore["mem-1"]?.targets).toEqual([]);
  });
});

describe("R5: operational outcome is shown, never success from outer observed", () => {
  const tool = (over: Partial<ProcedureEvidenceOption>) =>
    option("connectors.mcp.read", {
      evidence: {
        kind: "tool_observation",
        conversation_id: "conv-fixture",
        event_id: "attempt-1",
        sha256: "b".repeat(64),
      },
      outcome: "observed",
      ...over,
    });

  it("MCP nested unavailable under outer observed", () => {
    const o = tool({ operational_outcome: "unavailable" });
    expect(evidenceOptionText(o)).toMatch(
      /not proof it worked\) · Operation: Unavailable/,
    );
    expect(isFailureOutcome(o.outcome, o.operational_outcome)).toBe(true);
  });

  it("compute failed under outer observed, and outer failed", () => {
    const compute = tool({
      label: "compute.run",
      operational_outcome: "failed",
    });
    expect(evidenceOptionText(compute)).toContain(
      "Operation: Operation failed",
    );
    expect(isFailureOutcome(compute.outcome, compute.operational_outcome)).toBe(
      true,
    );
    const outer = tool({ outcome: "failed", operational_outcome: null });
    expect(evidenceOptionText(outer)).not.toContain("Operation:");
    expect(isFailureOutcome(outer.outcome, outer.operational_outcome)).toBe(
      true,
    );
  });

  it("outer observed alone is not success and not failure", () => {
    const o = tool({});
    expect(evidenceOptionText(o)).not.toMatch(/succe/i);
    expect(isFailureOutcome(o.outcome, o.operational_outcome)).toBe(false);
  });

  it("the picker marks nested failures", () => {
    const html = renderToStaticMarkup(
      createElement(EvidencePicker, {
        options: [tool({ operational_outcome: "unavailable" })],
        chosen: [],
        disabled: false,
        onToggle: () => undefined,
        onRetry: () => undefined,
      }),
    );
    expect(html).toContain('data-outcome="failed"');
    expect(html).toContain("Operation: Unavailable");
  });
});

describe("C1: reviewed inference stays inferred", () => {
  it("labels confidence by basis, not approval", () => {
    expect(CONFIDENCE_LABEL.inferred).toBe("Inferred, not directly stated");
    expect(CONFIDENCE_LABEL.explicit).toBe("Stated directly by you");
    expect(reviewedInference(rev("v1"))).toBe(true);
    expect(
      reviewedInference(
        rev("v1", { origin: "human_explicit", confidence_label: "explicit" }),
      ),
    ).toBe(false);
  });

  it("candidate review explains adoption isn't validation", () => {
    const html = renderToStaticMarkup(
      createElement(ProcedureWarnings, {
        r: rev("c", {
          status: "candidate",
          origin: "agent_inferred",
          procedure: null,
        }),
      }),
    );
    expect(html).toContain(
      "stays marked as inferred and isn’t a test that it works",
    );
  });
});
