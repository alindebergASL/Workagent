/**
 * Loads the permitted initial fixture records (SG-F1 … SG-F7) from Hermes's
 * canonical actor import (`fixtures/actor/solo-v0.1/initial_records.json`,
 * sha256 da744323…) and exposes them as selectable sources. No events,
 * expected outcomes or evaluator material are read here.
 */
import records from "../../../../fixtures/actor/solo-v0.1/initial_records.json";
import type { SourceDetail } from "@/lib/contract/types";

export interface FixtureRecord {
  id: string;
  version: string;
  surface: string;
  title: string;
  content: Record<string, unknown>;
}

export function loadInitialRecords(): FixtureRecord[] {
  // Static actor-only import: build tracing cannot sweep private backend env/logs.
  return records as FixtureRecord[];
}

export function recordById(id: string): FixtureRecord | undefined {
  return loadInitialRecords().find((r) => r.id === id);
}

/** Sources Alex can pick on Work Home: the documents and records, not the authority block. */
export const SELECTABLE_SOURCE_IDS = [
  "SG-F2",
  "SG-F3",
  "SG-F7",
  "SG-F6",
  "SG-F4",
] as const;

/** The sample request: Alex's own instruction from the delegation record (SG-F1). */
export function sampleRequest(): { text: string; source_ids: string[] } {
  const f1 = recordById("SG-F1");
  const text = (f1?.content["instruction"] as string | undefined) ?? "";
  return { text, source_ids: ["SG-F2", "SG-F3", "SG-F7"] };
}

export function excerptFor(record: FixtureRecord): string {
  const c = record.content;
  switch (record.id) {
    case "SG-F2": {
      const rows =
        (c["rows"] as {
          id: string;
          owner_recorded: boolean;
          next_action_recorded: boolean;
        }[]) ?? [];
      return [
        String(c["sample_note"] ?? ""),
        ...rows.map(
          (r) =>
            `${r.id}: owner ${r.owner_recorded ? "recorded" : "missing"}, next action ${
              r.next_action_recorded ? "recorded" : "missing"
            }`,
        ),
      ].join("\n");
    }
    case "SG-F3": {
      const obs = (c["observations"] as string[]) ?? [];
      const unknowns = (c["unknowns"] as string[]) ?? [];
      return [
        ...obs,
        `Candidate experiment: ${String(c["candidate_experiment"] ?? "")}`,
        ...unknowns.map((u) => `Unknown: ${u}`),
      ].join("\n");
    }
    case "SG-F7":
      return [
        `Priority: ${String(c["priority"] ?? "")}`,
        `Protected note: ${String(c["protected_note"] ?? "")}`,
        `Next review: ${String(c["next_review"] ?? "")}`,
        `Status: ${String(c["status"] ?? "")}`,
      ].join("\n");
    case "SG-F6": {
      const personal = (c["personal"] as Record<string, string>) ?? {};
      return [
        `Summary style: ${personal["summary_style"] ?? ""}`,
        `Detail: ${personal["detail"] ?? ""}`,
      ].join("\n");
    }
    case "SG-F4": {
      const events =
        (c["events"] as { summary: string; start: string; end: string }[]) ??
        [];
      return [
        `Working interval ${String(c["date"])} ${(c["working_interval"] as string[]).join("–")} UTC`,
        ...events.map((e) => `${e.start}–${e.end}: busy (private)`),
      ].join("\n");
    }
    default:
      return "";
  }
}

export function fixtureSources(observedAt: string): SourceDetail[] {
  return SELECTABLE_SOURCE_IDS.map((id) => {
    const r = recordById(id);
    if (!r) throw new Error(`fixture record ${id} missing`);
    return {
      id: r.id,
      title: r.title,
      version: r.version,
      surface: r.surface,
      observed_at: observedAt,
      excerpt: excerptFor(r),
      used_by_artifact_ids: [],
    };
  });
}
