import type { WorkSnapshot } from "@/lib/contract/work-events";

/** The conversation's work snapshot as this page last tried to read it. */
export type SnapshotRead =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; snapshot: WorkSnapshot };

export type NoteTime =
  { kind: "known"; at: string } | { kind: "unknown" } | { kind: "checking" };

export interface LatestNote {
  text: string;
  time: NoteTime;
}

/**
 * The agent's latest recorded note for one responsibility, with when it was
 * recorded. The text and its time always come from the same place: the
 * snapshot's observation for this exact assignment, both together. Without
 * one (snapshot unavailable, no matching responsibility, or none recorded)
 * the responsibility record's own text is kept with an unknown time; a
 * snapshot's time is never attached to other text, and a read or refresh
 * time is never offered as when the note was written. Nothing here says
 * which saved versions the note describes; the service doesn't record that.
 */
export function latestNote(
  outcome: string,
  assignmentId: string,
  read: SnapshotRead,
): LatestNote | null {
  if (read.kind === "ready") {
    const obs = read.snapshot.responsibility.find(
      (r) => r.assignment_id === assignmentId,
    )?.historical_observation;
    if (obs && obs.text.trim())
      return {
        text: obs.text,
        time: obs.observed_at
          ? { kind: "known", at: obs.observed_at }
          : { kind: "unknown" },
      };
  }
  if (!outcome.trim()) return null;
  return {
    text: outcome,
    time: read.kind === "loading" ? { kind: "checking" } : { kind: "unknown" },
  };
}
