"use client";
import { useState } from "react";
import { outcomePreview } from "@/lib/outcome-preview";

/**
 * What a responsibility has done so far, in its own recorded words: its
 * first sentence up front, the full text one click away, so what it
 * prepared and the steering stay in view.
 */
export function OutcomeLede({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const { lead, more } = outcomePreview(text);
  return (
    <p className="lede" data-testid="responsibility-outcome">
      {open || !more ? text.trim() : lead}
      {more ? (
        <>
          {" "}
          <button
            type="button"
            className="link-quiet small"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            data-testid="responsibility-outcome-toggle"
          >
            {open ? "Show less" : "Read all of it"}
          </button>
        </>
      ) : null}
    </p>
  );
}
