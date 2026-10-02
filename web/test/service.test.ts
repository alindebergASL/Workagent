import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env["WORKAGENT_MOCK_STATE_DIR"] = fs.mkdtempSync(
  path.join(os.tmpdir(), "workagent-mock-"),
);
process.env["WORKAGENT_MOCK_STAGE_MS"] = "1";
process.env["WORKAGENT_MOCK_PROPOSAL_MS"] = "600000";

const svc = await import("@/lib/mock/service");

const P = "alex";
const WS = "ws_alex";

function ready(): { assignmentId: string; planId: string; rev1: string } {
  const r = svc.createAssignment(P, WS, {
    command_id: `c-${Math.random()}`,
    goal: "Improve intake",
    selected_source_refs: [
      { id: "SG-F2", version: "1" },
      { id: "SG-F3", version: "1" },
      { id: "SG-F7", version: "1" },
    ],
    completion_criteria: [],
  });
  expect(r.status).toBe(202);
  svc.controlAdvance(r.body.assignment_id);
  const a = svc.getAssignment(P, WS, r.body.assignment_id);
  expect(a.state).toBe("ready_for_review");
  const plan = a.artifacts.find((x) => x.kind === "plan")!;
  return {
    assignmentId: a.id,
    planId: plan.id,
    rev1: plan.accepted_revision_id!,
  };
}

describe("mock service semantics", () => {
  beforeEach(() => svc.controlReset());

  it("rejects foreign principals and unknown ids identically", () => {
    const { assignmentId } = ready();
    expect(() => svc.getAssignment("mallory", WS, assignmentId)).toThrowError(
      /not found or you are not authorized/,
    );
    expect(() => svc.getAssignment(P, WS, "asg_nope")).toThrowError(
      /not found or you are not authorized/,
    );
  });

  it("human save uses CAS and a stale proposal conflicts without losing either body", () => {
    const { planId, rev1 } = ready();
    const art1 = svc.getArtifact(P, WS, planId);
    const req = svc.requestRevision(P, WS, planId, {
      command_id: "rr1",
      base_revision_id: rev1,
      instruction: "Add default owner",
    });
    expect(req.status).toBe(202);
    const body = art1.accepted_revision!.body.map((b) =>
      b.id === "pl-s2" ? { ...b, text: "Human wording" } : b,
    );
    const saved = svc.saveRevision(P, WS, planId, {
      command_id: "s1",
      expected_current_revision_id: rev1,
      body,
    });
    expect(saved.body.revision.sequence).toBe(2);
    expect(saved.body.revision.author.kind).toBe("human");
    // stale expected revision → version_conflict with current revision in details
    expect(() =>
      svc.saveRevision(P, WS, planId, {
        command_id: "s2",
        expected_current_revision_id: rev1,
        body,
      }),
    ).toThrowError(/changed since/);
    svc.controlReleaseProposal(req.body.proposal_id);
    const art2 = svc.getArtifact(P, WS, planId);
    expect(art2.accepted_revision_id).toBe(saved.body.revision.id);
    expect(art2.state).toBe("needs_review");
    expect(art2.pending_proposal?.status).toBe("conflicted");
    expect(JSON.stringify(art2.pending_proposal?.body)).not.toContain(
      "Human wording",
    );
    expect(JSON.stringify(art2.accepted_revision?.body)).toContain(
      "Human wording",
    );
    // accepting a conflicted proposal is refused; declining keeps it in history
    expect(() =>
      svc.acceptProposal(P, WS, planId, req.body.proposal_id, {
        command_id: "a1",
        expected_current_revision_id: art2.accepted_revision_id!,
      }),
    ).toThrow();
    const declined = svc.declineProposal(P, WS, planId, req.body.proposal_id, {
      command_id: "d1",
      expected_current_revision_id: art2.accepted_revision_id!,
    });
    expect(declined.body.proposal.status).toBe("declined");
    expect(svc.getArtifactHistory(P, WS, planId).proposals).toHaveLength(1);
  });

  it("replays identical commands and rejects changed payloads", () => {
    const { planId, rev1 } = ready();
    const body = svc.getArtifact(P, WS, planId).accepted_revision!.body;
    const first = svc.saveRevision(P, WS, planId, {
      command_id: "same",
      expected_current_revision_id: rev1,
      body,
    });
    const again = svc.saveRevision(P, WS, planId, {
      command_id: "same",
      expected_current_revision_id: rev1,
      body,
    });
    expect(again.body.revision.id).toBe(first.body.revision.id);
    expect(() =>
      svc.saveRevision(P, WS, planId, {
        command_id: "same",
        expected_current_revision_id: rev1,
        body: body.slice(1),
      }),
    ).toThrowError(/different payload/);
  });

  it("historical reads never move the accepted pointer", () => {
    const { planId, rev1 } = ready();
    const body = svc.getArtifact(P, WS, planId).accepted_revision!.body;
    const saved = svc.saveRevision(P, WS, planId, {
      command_id: "h1",
      expected_current_revision_id: rev1,
      body: body.map((b) => ({ ...b, text: `${b.text}!` })),
    });
    const old = svc.getArtifact(P, WS, planId, rev1);
    expect(old.accepted_revision?.id).toBe(rev1);
    expect(old.accepted_revision_id).toBe(saved.body.revision.id);
  });
});
