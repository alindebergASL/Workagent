/**
 * B3.2a research view helpers. Every wire shape is an alias of the generated
 * workagent/v1 contract (contracts/src/schema.d.ts, generated from
 * backend/workagent/research_models.py and workspace_file_models.py); nothing
 * here is a second wire contract. Captured public text is untrusted external
 * data: it is only ever rendered as inert text, never as HTML, and links are
 * offered only for plain https URLs.
 *
 * Exact quotes verify attribution, not claim truth: nothing in this module
 * derives a confidence, a verdict or an "entailed" state.
 */
import type { components } from "../../../contracts/src/client";

type S = components["schemas"];

export type SourceSnapshot = S["SourceSnapshot"];
export type PublicEvidence = S["PublicEvidence"];
export type ResearchCoverage = S["ResearchCoverage"];
export type ResearchSnapshotPage = S["ResearchSnapshotPage"];
export type ArtifactClaims = S["ArtifactClaims"];
export type ClaimFreshness = S["ClaimFreshness"];
export type ResearchClaim = S["ResearchClaim"];
export type QuoteRef = S["QuoteRef"];
export type ExtractionStatus = PublicEvidence["extraction_status"];

export const publicEvidence = (s: SourceSnapshot): PublicEvidence | null =>
  s.locator.kind === "public_source" ? (s.locator as PublicEvidence) : null;

/**
 * A browser link is offered only for an absolute https URL without embedded
 * credentials. Anything else (http, javascript:, data:, relative, malformed)
 * is shown as text only. Returns the normalized href or null.
 */
export function safeHttpsHref(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !u.hostname) return null;
  if (u.username || u.password) return null;
  return u.href;
}

/**
 * Exact Unicode character range (Python str code-point indices, which is
 * what the backend validates), never UTF-16 units.
 */
export function codePointSlice(text: string, start: number, end: number) {
  return Array.from(text).slice(start, end).join("");
}

export type QuoteCheck =
  | { state: "matches"; before: string; quote: string; after: string }
  | { state: "different_capture" }
  | { state: "mismatch" }
  | { state: "not_loaded" };

const CONTEXT = 80;

/**
 * Checks a quote against the exact captured text it cites. The snapshot must
 * be the one cited and its text hash must equal the quote's text hash; the
 * cited range must reproduce the quote exactly. Nothing is "close enough".
 */
export function checkQuote(
  ref: QuoteRef,
  snapshot: SourceSnapshot | null | undefined,
): QuoteCheck {
  if (!snapshot) return { state: "not_loaded" };
  const ev = publicEvidence(snapshot);
  if (!ev || snapshot.snapshot_id !== ref.snapshot_id)
    return { state: "different_capture" };
  if (ev.text_sha256 !== ref.text_sha256) return { state: "different_capture" };
  const chars = Array.from(ev.text);
  if (ref.end > chars.length || ref.start >= ref.end)
    return { state: "mismatch" };
  const quote = chars.slice(ref.start, ref.end).join("");
  if (quote !== ref.quote) return { state: "mismatch" };
  return {
    state: "matches",
    before: chars.slice(Math.max(0, ref.start - CONTEXT), ref.start).join(""),
    quote,
    after: chars.slice(ref.end, ref.end + CONTEXT).join(""),
  };
}

export const RELATION_LABEL: Record<QuoteRef["relation"], string> = {
  supports: "Cited as support",
  contradicts: "Cited as contradicting",
  context: "Cited as context",
};

export const SEMANTIC_LABEL: Record<ResearchClaim["semantic_status"], string> =
  {
    not_assessed:
      "Not checked for meaning — the quotes are exact, the claim is not verified by them",
    unsupported: "No supporting quote recorded for this claim",
    conflict: "Sources disagree — both sides are shown",
  };

const EXTRACTION_LABEL: Record<ExtractionStatus, string> = {
  extracted: "Text captured",
  empty: "The page had no readable text",
  truncated: "Only part of the text was captured",
  unavailable: "The text could not be captured",
};

export const extractionLabel = (s: string): string =>
  (EXTRACTION_LABEL as Record<string, string>)[s] ?? `Capture status: ${s}`;

/**
 * Plain coverage notes. Every bound, gap and empty state is named; a
 * complete capture says so once. Never collapses an omission into "OK".
 */
export function coverageNotes(ev: PublicEvidence): string[] {
  const notes: string[] = [];
  if (ev.extraction_status !== "extracted")
    notes.push(extractionLabel(ev.extraction_status) + ".");
  if (!ev.coverage.body_complete)
    notes.push("The page body was not fully retrieved (size or time bound).");
  if (!ev.coverage.text_complete)
    notes.push("Not all of the retrieved text was kept.");
  if (ev.browser_used)
    notes.push(
      "Read with an offline browser (no network, outside assets or accounts); rendering may be partial.",
    );
  if (ev.text.length === 0 && ev.extraction_status === "extracted")
    notes.push("No text was captured.");
  for (const o of ev.coverage.omissions) notes.push(`Omitted: ${o}`);
  return notes;
}

/**
 * Merges a further page of snapshots onto what is already shown, keeping the
 * server order and never dropping or duplicating a source.
 */
export function appendSnapshotPage(
  shown: SourceSnapshot[],
  next: ResearchSnapshotPage,
): SourceSnapshot[] {
  const seen = new Set(shown.map((s) => s.snapshot_id));
  return [...shown, ...next.items.filter((s) => !seen.has(s.snapshot_id))];
}

export const shortHash = (h: string) =>
  h.length > 12 ? `${h.slice(0, 12)}…` : h;
