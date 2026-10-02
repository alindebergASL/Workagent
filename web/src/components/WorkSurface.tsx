"use client";
import { useEffect, useState, type ReactNode } from "react";

/** Both panes remain mounted: switching never discards edits or pending commands. */
export function WorkSurface({
  work,
  revision,
  requesting,
}: {
  work: ReactNode;
  revision: ReactNode;
  requesting: boolean;
}) {
  const [pane, setPane] = useState<"work" | "revision">("work");
  useEffect(() => {
    if (requesting) setPane("revision");
  }, [requesting]);
  return (
    <section className="working-surface" data-pane={pane}>
      <div className="working-switch" aria-label="Working view">
        <button
          className="btn"
          aria-pressed={pane === "work"}
          onClick={() => setPane("work")}
        >
          Work
        </button>
        <button
          className="btn"
          aria-pressed={pane === "revision"}
          onClick={() => setPane("revision")}
        >
          Ask for revision
        </button>
      </div>
      <div className="working-document stack">{work}</div>
      <aside className="working-revision stack">{revision}</aside>
    </section>
  );
}
