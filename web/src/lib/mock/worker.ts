/**
 * MOCK worker. Produces deterministic demonstration bodies from the permitted
 * fixture records. It is not a model run and proves nothing about generated
 * output quality or runtime behavior. The intake calculation is generic
 * (union of cases missing an owner or a next action); nothing is hardcoded.
 */
import { createHash } from "node:crypto";
import type { Block, Recommendation } from "@/lib/contract/types";
import { recordById } from "./fixture";

interface IntakeRow {
  id: string;
  owner_recorded: boolean;
  next_action_recorded: boolean;
}

export interface IntakeAnalysis {
  total: number;
  affected: string[];
  missing_owner: string[];
  missing_next_action: string[];
  both: string[];
}

export function analyzeIntake(rows: IntakeRow[]): IntakeAnalysis {
  const missing_owner = rows.filter((r) => !r.owner_recorded).map((r) => r.id);
  const missing_next_action = rows
    .filter((r) => !r.next_action_recorded)
    .map((r) => r.id);
  const affectedSet = new Set<string>([
    ...missing_owner,
    ...missing_next_action,
  ]);
  const affected = rows.map((r) => r.id).filter((id) => affectedSet.has(id));
  const both = missing_owner.filter((id) => missing_next_action.includes(id));
  return {
    total: rows.length,
    affected,
    missing_owner,
    missing_next_action,
    both,
  };
}

export function bodyHash(body: Block[]): string {
  const canonical = JSON.stringify(
    body.map((b) => ({
      id: b.id,
      kind: b.kind,
      text: b.text,
      source_ids: b.source_ids ?? [],
      checked: b.checked ?? null,
    })),
  );
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function pct(n: number, d: number): string {
  if (d === 0) return "n/a";
  return `${Math.round((n / d) * 100)}%`;
}

export function intakeRows(sourceIds: string[]): IntakeRow[] | null {
  if (!sourceIds.includes("SG-F2")) return null;
  const f2 = recordById("SG-F2");
  return (f2?.content["rows"] as IntakeRow[] | undefined) ?? null;
}

export function buildRecommendation(sourceIds: string[]): Recommendation {
  const rows = intakeRows(sourceIds);
  const f3 = sourceIds.includes("SG-F3") ? recordById("SG-F3") : undefined;
  if (!rows) {
    return {
      summary:
        "No intake log was selected, so no change could be measured. Add the intake review log to get a recommendation.",
      evidence: [],
      uncertainty: ["Without the log there is no case-level evidence."],
    };
  }
  const a = analyzeIntake(rows);
  const evidence = [
    `${a.affected.length} of ${a.total} cases (${pct(a.affected.length, a.total)}) are missing an owner, a next action, or both: ${a.affected.join(", ")}.`,
    `${a.missing_owner.length} missing an owner (${a.missing_owner.join(", ") || "none"}); ${a.missing_next_action.length} missing a next action (${a.missing_next_action.join(", ") || "none"}); ${a.both.length} missing both (${a.both.join(", ") || "none"}). Each case is counted once.`,
  ];
  const unknowns = (f3?.content["unknowns"] as string[] | undefined) ?? [];
  return {
    summary:
      "Require an owner and a next action before any request leaves intake. Test it on the next eight cases before adding anything else.",
    evidence,
    uncertainty: [
      ...unknowns,
      "Eight personal practice cases from one week; not a representative population.",
    ],
  };
}

export function buildAnalysisBody(sourceIds: string[]): Block[] {
  const rec = buildRecommendation(sourceIds);
  const rows = intakeRows(sourceIds);
  const blocks: Block[] = [
    { id: "an-h1", kind: "heading", text: "Recommendation" },
    {
      id: "an-p1",
      kind: "paragraph",
      text: rec.summary,
      source_ids: rows ? ["SG-F2", "SG-F3"] : [],
    },
    { id: "an-h2", kind: "heading", text: "What the log shows" },
  ];
  rec.evidence.forEach((e, i) =>
    blocks.push({
      id: `an-e${i + 1}`,
      kind: "paragraph",
      text: e,
      source_ids: ["SG-F2"],
    }),
  );
  if (rows) {
    const a = analyzeIntake(rows);
    rows.forEach((r) =>
      blocks.push({
        id: `an-row-${r.id}`,
        kind: "list_item",
        text: `${r.id}: owner ${r.owner_recorded ? "recorded" : "missing"} · next action ${r.next_action_recorded ? "recorded" : "missing"}${a.affected.includes(r.id) ? " · affected" : ""}`,
        source_ids: ["SG-F2"],
      }),
    );
  }
  blocks.push({
    id: "an-h3",
    kind: "heading",
    text: "What this does not tell you",
  });
  rec.uncertainty.forEach((u, i) =>
    blocks.push({
      id: `an-u${i + 1}`,
      kind: "list_item",
      text: u,
      source_ids: ["SG-F3"],
    }),
  );
  return blocks;
}

export function buildPlanBody(sourceIds: string[]): Block[] {
  const f7 = sourceIds.includes("SG-F7") ? recordById("SG-F7") : undefined;
  const f3 = sourceIds.includes("SG-F3") ? recordById("SG-F3") : undefined;
  const rows = intakeRows(sourceIds);
  const a = rows ? analyzeIntake(rows) : null;
  const priority =
    (f7?.content["priority"] as string | undefined) ??
    "Improve the intake-review method.";
  const protectedNote = f7?.content["protected_note"] as string | undefined;
  const nextReview = f7?.content["next_review"] as string | undefined;
  const experiment =
    (f3?.content["candidate_experiment"] as string | undefined) ??
    "Use an owner-and-next-action check on the next eight cases.";
  const blocks: Block[] = [
    { id: "pl-h1", kind: "heading", text: "Priority" },
    {
      id: "pl-p1",
      kind: "paragraph",
      text: priority,
      source_ids: f7 ? ["SG-F7"] : [],
    },
    { id: "pl-h2", kind: "heading", text: "One change to test" },
    {
      id: "pl-p2",
      kind: "paragraph",
      text: experiment,
      source_ids: f3 ? ["SG-F3"] : [],
    },
    {
      id: "pl-p3",
      kind: "paragraph",
      text: a
        ? `Baseline from last week: ${a.affected.length} of ${a.total} cases lacked an owner or next action. The test passes if the next eight cases all have both recorded at intake.`
        : "No baseline was measured because the intake log was not selected.",
      source_ids: a ? ["SG-F2"] : [],
    },
    { id: "pl-h3", kind: "heading", text: "This week" },
    {
      id: "pl-s1",
      kind: "list_item",
      text: "Add owner and next-action fields to the intake log before the next case arrives.",
      source_ids: ["SG-F2"],
    },
    {
      id: "pl-s2",
      kind: "list_item",
      text: "Review each new case with the checklist at the point of intake, not afterwards.",
    },
    {
      id: "pl-s3",
      kind: "list_item",
      text: "Record time spent per review so the next decision has data rather than a guess.",
      source_ids: f3 ? ["SG-F3"] : [],
    },
  ];
  if (protectedNote) {
    blocks.push({ id: "pl-h4", kind: "heading", text: "Protected time" });
    blocks.push({
      id: "pl-protected",
      kind: "paragraph",
      text: protectedNote,
      source_ids: ["SG-F7"],
    });
  }
  blocks.push({ id: "pl-h5", kind: "heading", text: "Next review" });
  blocks.push({
    id: "pl-p5",
    kind: "paragraph",
    text: nextReview
      ? `Review the eight-case result on ${nextReview}. Decide then whether to keep the check, change it, or stop.`
      : "Set a review date once the first eight cases are in.",
    source_ids: nextReview ? ["SG-F7"] : [],
  });
  return blocks;
}

export function buildChecklistBody(sourceIds: string[]): Block[] {
  const rows = intakeRows(sourceIds);
  return [
    { id: "ck-h1", kind: "heading", text: "Intake review checklist" },
    {
      id: "ck-p1",
      kind: "paragraph",
      text: "Run this once per request before it leaves intake. Every item must be true.",
      source_ids: rows ? ["SG-F2"] : [],
    },
    {
      id: "ck-1",
      kind: "check_item",
      text: "One named owner is recorded.",
      checked: false,
      source_ids: rows ? ["SG-F2"] : [],
    },
    {
      id: "ck-2",
      kind: "check_item",
      text: "One concrete next action is recorded, with a date.",
      checked: false,
      source_ids: rows ? ["SG-F2"] : [],
    },
    {
      id: "ck-3",
      kind: "check_item",
      text: "The request’s desired outcome is written in one sentence.",
      checked: false,
    },
    {
      id: "ck-4",
      kind: "check_item",
      text: "Anything blocking the next action is named, or marked “none”.",
      checked: false,
    },
    {
      id: "ck-5",
      kind: "check_item",
      text: "Review time was noted so the method can be measured later.",
      checked: false,
      source_ids: ["SG-F3"],
    },
  ];
}

/** Agent revision proposal: a visible, bounded change applied to the base body. */
export function buildProposalBody(base: Block[], instruction: string): Block[] {
  const stamp = createHash("sha256")
    .update(instruction)
    .digest("hex")
    .slice(0, 6);
  const body = base.map((b) => ({ ...b }));
  const idx = body.findIndex((b) => b.id === "pl-h3" || b.kind === "heading");
  const insertAt = idx >= 0 ? idx : body.length;
  body.splice(
    insertAt,
    0,
    { id: `pr-h-${stamp}`, kind: "heading", text: "Proposed change" },
    {
      id: `pr-p-${stamp}`,
      kind: "paragraph",
      text: `Requested: ${instruction.trim()}`,
    },
    {
      id: `pr-l-${stamp}`,
      kind: "list_item",
      text: "Pair the owner field with a default owner of “me” so no case can be saved blank.",
    },
  );
  return body;
}
