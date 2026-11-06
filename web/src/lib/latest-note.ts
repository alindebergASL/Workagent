import type { WorkSnapshot } from "@/lib/contract/work-events";

/** The conversation's work snapshot as this page last tried to read it. */
export type SnapshotRead =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; snapshot: WorkSnapshot };

export type NoteTime =
  | { kind: "known"; at: string }
  /** Read fine: no time was recorded with the note. */
  | { kind: "unknown" }
  /** The snapshot couldn't be read, so whether a time exists is unknown. */
  | { kind: "unchecked" }
  | { kind: "checking" };

export interface LatestNote {
  text: string;
  time: NoteTime;
}

/**
 * The latest recorded note for one responsibility (written by the agent,
 * the person or the runtime), with when it was recorded. The text and its
 * time always come from the same place: the snapshot's observation for this
 * exact assignment, both together. Without one the responsibility record's
 * own text is kept with no time: "not recorded" when the snapshot was read
 * and has none for it, "couldn't be checked" when it couldn't be read. A
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
    time:
      read.kind === "loading"
        ? { kind: "checking" }
        : read.kind === "unavailable"
          ? { kind: "unchecked" }
          : { kind: "unknown" },
  };
}
