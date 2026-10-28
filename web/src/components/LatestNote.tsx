"use client";
import type { LatestNote as Note } from "@/lib/latest-note";
import { formatTime } from "@/lib/time";
import { OutcomeLede } from "./OutcomeLede";

/**
 * The latest recorded note, labelled as such with when it was recorded, that
 * the time wasn't recorded, or that it couldn't be checked. Not attributed to
 * the agent: the person or the runtime may have written it. Set apart from
 * what's prepared below: it is a note from that time, not a description of
 * the current versions of the outputs.
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
        Latest recorded note
        {time.kind === "checking" ? null : (
          <span data-testid="latest-note-time">
            {" · "}
            {time.kind === "known"
              ? formatTime(time.at, zone)
              : time.kind === "unchecked"
                ? "time couldn’t be checked"
                : "time not recorded"}
          </span>
        )}
      </p>
      <OutcomeLede text={note.text} />
    </section>
  );
}
