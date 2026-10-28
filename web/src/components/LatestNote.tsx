"use client";
import type { LatestNote as Note } from "@/lib/latest-note";
import { formatTime } from "@/lib/time";
import { OutcomeLede } from "./OutcomeLede";

/**
 * The agent's own latest recorded note, labelled as such with when it was
 * recorded (or that the time wasn't). Set apart from what's prepared below:
 * it is the agent's words at that time, not a description of the current
 * versions of its outputs.
 */
export function LatestNote({ note, zone }: { note: Note; zone: string }) {
  const { time } = note;
  return (
    <section
      className="latest-note"
      aria-labelledby="latest-note-label"
      data-testid="latest-note"
      data-time={time.kind}
    >
      <p className="eyebrow" id="latest-note-label">
        Agent’s latest recorded note
        {time.kind === "checking" ? null : (
          <span data-testid="latest-note-time">
            {" · "}
            {time.kind === "known"
              ? formatTime(time.at, zone)
              : "time not recorded"}
          </span>
        )}
      </p>
      <OutcomeLede text={note.text} />
    </section>
  );
}
