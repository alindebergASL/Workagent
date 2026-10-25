"use client";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Work and its conversation side by side on wide screens. On phones one pane shows at
 * a time and the document comes first. Both panes stay mounted, so switching
 * never discards an unsaved edit, a typed instruction or a pending command.
 */
export function WorkSurface({
  document,
  agent,
  focusAgent,
  focusWork = 0,
  title,
}: {
  document: ReactNode;
  agent: ReactNode;
  /**
   * The work's name, when the page's heading is inside the work pane: on a
   * phone the conversation pane shows it instead while the work is hidden.
   */
  title?: string;
  /** Increment to bring the agent pane forward (e.g. "Request revision"). */
  focusAgent: number;
  /** Increment to return to the document (e.g. after a request is sent). */
  focusWork?: number;
}) {
  const [pane, setPane] = useState<"work" | "agent">("work");
  useEffect(() => {
    if (focusAgent > 0) setPane("agent");
  }, [focusAgent]);
  useEffect(() => {
    if (focusWork > 0) setPane("work");
  }, [focusWork]);
  return (
    <section
      className="working-surface"
      data-pane={pane}
      aria-label="Working view"
    >
      <div className="working-switch" role="group" aria-label="Show">
        <button
          type="button"
          className="seg"
          aria-pressed={pane === "work"}
          onClick={() => setPane("work")}
        >
          Work
        </button>
        <button
          type="button"
          className="seg"
          aria-pressed={pane === "agent"}
          onClick={() => setPane("agent")}
        >
          Conversation
        </button>
      </div>
      <section className="working-agent" aria-label="Conversation">
        {title ? <h1 className="working-agent-title">{title}</h1> : null}
        {agent}
      </section>
      <div className="working-document">{document}</div>
    </section>
  );
}
