import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "@/lib/contract/errors";
import {
  EvidencePicker,
  ProcedureFacts,
  ProcedureFields,
  ProcedureWarnings,
} from "@/components/MemoryPanel";
import { MemoryCommandJournal } from "@/lib/client/memory-commands";
import type { MemoryCommand } from "@/lib/client/memory";
import {
  correctionBody,
  emptyProcedureForm,
  emptyRememberForm,
  evidenceOptionText,
  isFailureOutcome,
  needsProcedureDetails,
  procedureCandidateBody,
  procedureFormOf,
  procedureOf,
  procedureProblem,
  rememberProblem,
  OUTCOME_LABEL,
  renderable,
  rollbackBody,
  rollbackTargets,
  type MemoryInspection,
  type MemoryRevision,
  type ProcedureDetails,
  type ProcedureEvidence,
  type ProcedureEvidenceOption,
  type ProcedureForm,
  type EvidenceOutcome,
} from "@/lib/memory-contract";

/**
 * B3.4a evidence-backed procedures and rollback. All data are SYNTHETIC
 * FIXTURES (no server, no provider), shaped per B34A-CONTRACT.md.
 */
const ENV = {
  schema_version: "workagent/v1" as const,
  request_id: "req-fixture-1",
  command_id: "cmd-fixture-1",
};

const EV_TOOL: ProcedureEvidence = {
  kind: "tool_observation",
  conversation_id: "conv-fixture",
  event_id: "attempt-fixture-1",
  sha256: "b".repeat(64),
};
const EV_HUMAN: ProcedureEvidence = {
  kind: "human_message",
  conversation_id: "conv-fixture",
  event_id: "msg-fixture-1",
  sha256: "c".repeat(64),
};
const DETAILS: ProcedureDetails = {
  retrieval_terms: ["release notes"],
  excluded_terms: ["v1 api"],
  counterexamples: ["Never skip the signature check"],
  evidence: [EV_TOOL],
  validation_notes: "Observed once; the speedup is a hypothesis.",
};
const FILE_REF = {
  source_type: "file" as const,
  ref: {
    workspace_file_id: "file-fixture",
    version_id: "ver-fixture-2",
    sha256: "d".repeat(64),
  },
} as NonNullable<MemoryRevision["source_refs"]>[number];

const prev = (over: Partial<MemoryRevision> = {}): MemoryRevision =>
  ({
    memory_id: "mem-fixture-1",
    revision_id: "rev-fixture-1",
    workspace_id: "ws-fixture",
    owner_id: "owner-fixture",
    kind: "procedure",
    scope_kind: "task",
    scope_id: "conv-fixture",
    subject_key: "release_notes",
    predicate_key: "procedure",
    content: "FIXTURE: draft release notes from the changelog first",
    content_sha256: "a".repeat(64),
    status: "active",
    origin: "human_reviewed",
    confidence_label: "observed",
    confidence_basis: "Observed tool result",
    applicability: "Writing release notes",
    source_refs: [FILE_REF],
    evidence_ids: [],
    access_generation: 1,
    recorded_at: "2026-10-20T10:00:00Z",
    valid_from: "2026-10-20T10:00:00Z",
    reviewed_by_principal_id: "owner-fixture",
    procedure: DETAILS,
    ...over,
  }) as MemoryRevision;

const fullForm = (over: Partial<ProcedureForm> = {}): ProcedureForm => ({
  applicability: "Writing release notes",
  confidence_basis: "The tool run below finished",
  counterexamples: "Never skip the signature check\n\n",
  validation_notes: " Observed once ",
  retrieval_terms: "release notes\nchangelog",
  excluded_terms: "v1 api",
  ...over,
});

describe("procedure proposal", () => {
  it("requires applicability, basis, limits, evidence and matching words", () => {
    expect(procedureProblem(emptyProcedureForm(), [EV_TOOL])).toMatch(
      /applies/,
    );
    expect(
      procedureProblem(fullForm({ confidence_basis: " " }), [EV_TOOL]),
    ).toMatch(/based on/);
    expect(
      procedureProblem(fullForm({ counterexamples: "\n" }), [EV_TOOL]),
    ).toMatch(/limit/);
    expect(procedureProblem(fullForm(), [])).toMatch(/observation/);
    expect(
      procedureProblem(fullForm({ retrieval_terms: "" }), [EV_TOOL]),
    ).toMatch(/matching word/);
    expect(procedureProblem(fullForm(), [EV_TOOL])).toBeNull();
  });

  it("never applies a procedure to all work in the workspace", () => {
    const f = {
      ...emptyRememberForm(),
      kind: "procedure" as const,
      content: "x",
    };
    expect(rememberProblem({ ...f, scope_kind: "user" })).toMatch(
      /conversation or a chosen project/,
    );
    expect(rememberProblem({ ...f, scope_kind: "task" })).toBeNull();
    expect(rememberProblem({ ...f, scope_kind: "work_area" })).toBeNull();
    // Other kinds may still be general preferences.
    expect(
      rememberProblem({ ...f, kind: "preference", scope_kind: "user" }),
    ).toBeNull();
  });

  it("is always a procedure candidate carrying exact references only", () => {
    const body = procedureCandidateBody(
      {
        ...emptyRememberForm(),
        kind: "procedure",
        content: "Draft from the changelog first",
      },
      fullForm(),
      [EV_TOOL, EV_HUMAN],
      [FILE_REF],
      "conv-fixture",
      ENV,
    );
    expect(body.kind).toBe("procedure");
    expect(body.confidence_basis).toBe("The tool run below finished");
    expect(body.confidence_basis).not.toMatch(/explicit human/i);
    expect(body.source_refs).toEqual([FILE_REF]);
    expect(body.procedure).toEqual({
      retrieval_terms: ["release notes", "changelog"],
      excluded_terms: ["v1 api"],
      counterexamples: ["Never skip the signature check"],
      evidence: [EV_TOOL, EV_HUMAN],
      validation_notes: "Observed once",
    });
    // Exactly the canonical ProcedureEvidence keys; no copied content.
    expect(Object.keys(body.procedure.evidence[0]!).sort()).toEqual([
      "conversation_id",
      "event_id",
      "kind",
      "sha256",
    ]);
  });
});

describe("evidence options", () => {
  const opt = (outcome: EvidenceOutcome): ProcedureEvidenceOption => ({
    evidence: EV_TOOL,
    label: "Ran the changelog export",
    outcome,
    observed_at: "2026-10-20T10:00:00Z",
  });

  it("never presents a failure as a success", () => {
    expect(OUTCOME_LABEL).toEqual({
      human_statement: "What you said",
      observed: "Observed (a record it happened, not proof it worked)",
      failed: "Failed",
      cost_only: "Only a cost was recorded",
      outcome_unknown: "Outcome unknown",
    });
    expect(isFailureOutcome("failed")).toBe(true);
    expect(isFailureOutcome("outcome_unknown")).toBe(true);
    expect(isFailureOutcome("cost_only")).toBe(true);
    expect(isFailureOutcome("observed")).toBe(false);
    for (const o of Object.keys(OUTCOME_LABEL) as EvidenceOutcome[])
      expect(evidenceOptionText(opt(o))).not.toMatch(/succe/i);
    expect(evidenceOptionText(opt("observed"))).toMatch(/not proof it worked/);
    const html = renderToStaticMarkup(
      createElement(EvidencePicker, {
        options: [opt("failed"), { ...opt("observed"), evidence: EV_HUMAN }],
        chosen: [EV_HUMAN],
        disabled: false,
        onToggle: () => undefined,
        onRetry: () => undefined,
      }),
    );
    expect(html).toContain('data-outcome="failed"');
    expect(html).not.toMatch(/succe/i);
    expect(html).toContain("doesn’t show the lesson works");
    // Long references wrap on 320px phones instead of overflowing.
    expect(html).toContain("overflow-wrap:anywhere");
  });

  it("shows load failure and empty states honestly", () => {
    const err = renderToStaticMarkup(
      createElement(EvidencePicker, {
        options: { error: "Offline." },
        chosen: [],
        disabled: false,
        onToggle: () => undefined,
        onRetry: () => undefined,
      }),
    );
    expect(err).toContain("Couldn’t load what happened here. Offline.");
    const none = renderToStaticMarkup(
      createElement(EvidencePicker, {
        options: [],
        chosen: [],
        disabled: false,
        onToggle: () => undefined,
        onRetry: () => undefined,
      }),
    );
    expect(none).toContain("Nothing in this conversation can be cited yet.");
  });
});

describe("procedure inspection", () => {
  it("shows exact evidence, limits and matching words, never as instructions", () => {
    const html = renderToStaticMarkup(
      createElement(ProcedureFacts, { r: prev() }),
    );
    expect(html).toContain("event_id: attempt-fixture-1");
    expect(html).toContain(`sha256: ${"b".repeat(64)}`);
    expect(html).toContain("Never skip the signature check");
    expect(html).toContain("references, not instructions");
    expect(html).toContain("Never when a request mentions: v1 api");
  });

  it("warns on unreviewed candidates, missing details and source dependencies", () => {
    const cand = renderToStaticMarkup(
      createElement(ProcedureWarnings, {
        r: prev({ status: "candidate", origin: "agent_inferred" }),
      }),
    );
    expect(cand).toContain("isn’t used in any work until you accept it");
    expect(cand).toContain("Depends on the sources listed");
    const legacy = prev({ procedure: null });
    expect(needsProcedureDetails(legacy)).toBe(true);
    expect(
      renderToStaticMarkup(createElement(ProcedureWarnings, { r: legacy })),
    ).toContain("can’t be accepted or used");
  });

  it("erasure drops procedure details too", () => {
    const gone = renderable(prev({ status: "forgotten", content: null }));
    expect(gone.procedure).toBeNull();
    expect(procedureOf(gone)).toBeNull();
    expect(gone.source_refs).toEqual([]);
  });

  it("labels fields plainly, matching words as a secondary detail", () => {
    const html = renderToStaticMarkup(
      createElement(ProcedureFields, {
        value: procedureFormOf(prev(), DETAILS),
        disabled: false,
        onChange: () => undefined,
      }),
    );
    expect(html).toContain("Limits and cases where it doesn’t apply");
    expect(html).toMatch(/<details><summary[^>]*>Matching words/);
    const fixed = renderToStaticMarkup(
      createElement(ProcedureFields, {
        value: procedureFormOf(prev(), DETAILS),
        disabled: false,
        fixedContext: true,
        onChange: () => undefined,
      }),
    );
    expect(fixed).toContain('data-testid="memory-procedure-fixed"');
    expect(fixed).toContain("Writing release notes");
    expect(fixed.match(/<textarea/g)).toHaveLength(4);
  });
});

describe("procedure correction", () => {
  it("keeps the base's exact evidence and sources, CAS on the pinned base", () => {
    const r = prev();
    const body = correctionBody(
      {
        base: r.revision_id,
        content: "Draft from the changelog, then check signatures",
        mode: "permanent",
        from: "",
        until: "",
        procedure: { ...procedureFormOf(r, DETAILS), validation_notes: "x" },
        keep: { evidence: DETAILS.evidence, source_refs: r.source_refs ?? [] },
      },
      ENV,
    ) as ReturnType<typeof correctionBody> & { procedure: ProcedureDetails };
    expect(body.expected_revision_id).toBe("rev-fixture-1");
    expect(body.source_refs).toEqual([FILE_REF]);
    expect(body.procedure.evidence).toEqual([EV_TOOL]);
    expect(body.procedure.validation_notes).toBe("x");
    // Fixed at correction in this slice: never sent.
    expect(body).not.toHaveProperty("applicability");
    expect(body).not.toHaveProperty("confidence_basis");
  });

  it("non-procedure corrections are unchanged", () => {
    const body = correctionBody(
      { base: "rev", content: "c", mode: "permanent", from: "", until: "" },
      ENV,
    );
    expect(body).not.toHaveProperty("procedure");
    expect(body.source_refs).toEqual([]);
  });
});

describe("rollback", () => {
  const cur = prev({ revision_id: "rev-3" });
  // API-shaped history: inspection projects the adopted v1 as superseded.
  const v1 = prev({ revision_id: "rev-1", status: "superseded" });
  const ins = (
    revisions: MemoryRevision[],
    ids?: string[],
    current = cur,
  ): MemoryInspection =>
    ({
      current,
      revisions,
      notice: "",
      ...(ids ? { rollback_revision_ids: ids } : {}),
    }) as MemoryInspection;

  it("offers exactly the server-listed revisions, superseded included", () => {
    const contested = prev({ revision_id: "rev-x", status: "superseded" });
    const rejected = prev({ revision_id: "rev-r", status: "expired" });
    const temp = prev({
      revision_id: "rev-t",
      status: "superseded",
      valid_until: "2026-11-01T00:00:00Z",
    });
    const history = [v1, contested, rejected, temp, cur];
    expect(
      rollbackTargets(ins(history, ["rev-1", "rev-3"])).map(
        (t) => t.revision_id,
      ),
    ).toEqual(["rev-1"]); // current excluded even if listed
  });

  it("absent or empty ids means nothing can be restored", () => {
    // Even an "active human_reviewed" revision is not offered by status.
    const raw = prev({ revision_id: "rev-1" });
    expect(rollbackTargets(ins([raw, cur]))).toEqual([]);
    expect(rollbackTargets(ins([raw, cur], []))).toEqual([]);
  });

  it("never offers an erased revision even if listed", () => {
    const gone = prev({
      revision_id: "rev-1",
      status: "forgotten",
      content: null,
    });
    expect(rollbackTargets(ins([gone, cur], ["rev-1"]))).toEqual([]);
  });

  it("an unknown rollback outcome replays the exact same command only on request", async () => {
    const sent: MemoryCommand[] = [];
    let fail = true;
    const journal = new MemoryCommandJournal("k", {
      send: async (c) => {
        sent.push(c);
        if (fail) {
          fail = false;
          throw new ApiError({ code: "transport", status: 0, message: "lost" });
        }
        return {
          memory_id: "mem-fixture-1",
          revision_id: "rev-4",
          status: "active",
        };
      },
      inspect: async () => ins([], undefined, prev({ revision_id: "rev-4" })),
    });
    const cmd: MemoryCommand = {
      op: "rollback",
      memoryId: "mem-fixture-1",
      body: rollbackBody(ENV, "rev-3", "rev-1"),
    };
    expect(cmd.body).toEqual({
      ...ENV,
      expected_revision_id: "rev-3",
      target_revision_id: "rev-1",
    });
    const first = await journal.submit(cmd);
    expect(first.kind).toBe("unknown");
    expect((await journal.submit({ ...cmd })).kind).toBe("blocked");
    const second = await journal.replay();
    expect(second.kind).toBe("verified");
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
  });
});
