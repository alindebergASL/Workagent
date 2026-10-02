import type { Block, Recommendation } from "@/lib/contract/types";

/**
 * The assignment's recommendation, read from the CURRENT SAVED document only
 * (never an unaccepted proposal).
 *
 * Managed worker documents (handoffs/backend/RESPONSES_REVIEW_FIXES.md) start
 * with one current group: `managed.current.<attempt>` followed by
 * `managed.next-action.<attempt>`, `managed.missing-information.<attempt>`,
 * `managed.source-basis.<attempt>`, `managed.specific-judgment.<attempt>` and
 * `managed.scope.<attempt>`. A revision then retains earlier content (which can
 * include older managed groups) after `managed.history.<attempt>`. Only the
 * FIRST `managed.current.` group and its exact attempt suffix are current.
 *
 * Older fixture documents keep their `recommendation` / `evidence` /
 * `unknowns` blocks.
 */
export function recommendationFrom(blocks: Block[]): Recommendation {
  return managedRecommendation(blocks) ?? fixtureRecommendation(blocks);
}

/** True when the document carries a current managed group. */
export function hasManagedGroup(blocks: Block[]): boolean {
  return blocks.some((b) => b.id.startsWith(CURRENT));
}

const CURRENT = "managed.current.";

function managedRecommendation(blocks: Block[]): Recommendation | null {
  const current = blocks.find((b) => b.id.startsWith(CURRENT));
  if (!current) return null;
  const attempt = current.id.slice(CURRENT.length);
  const section = (name: string, heading: string): string | null => {
    const block = blocks.find((b) => b.id === `managed.${name}.${attempt}`);
    return block ? stripHeading(block.text, heading) : null;
  };
  const lines = (text: string | null) =>
    (text ?? "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  const next = section("next-action", "Next action (proposed)");
  const judgment = section("specific-judgment", "Specific judgment");
  return {
    summary: next || "Review the saved work",
    evidence: lines(section("source-basis", "Source basis")),
    uncertainty: lines(section("missing-information", "Missing information")),
    ...(judgment ? { judgment } : {}),
  };
}

/** Drops the display heading the worker prefixes ("Heading: "), never the substance. */
function stripHeading(text: string, heading: string): string {
  const prefix = `${heading}: `;
  return (text.startsWith(prefix) ? text.slice(prefix.length) : text).trim();
}

function fixtureRecommendation(blocks: Block[]): Recommendation {
  return {
    summary:
      blocks.find((b) => b.id === "recommendation")?.text ??
      "Review the saved work",
    evidence: blocks.filter((b) => b.id === "evidence").map((b) => b.text),
    uncertainty: blocks.filter((b) => b.id === "unknowns").map((b) => b.text),
  };
}
