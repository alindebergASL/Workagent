import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocRead } from "../src/components/DocBody";
import type { Block } from "../src/lib/contract/types";

describe("reading a saved document", () => {
  it("keeps the line breaks a paragraph was saved with, unchanged", () => {
    const text = "Use plain words.\nKeep each line short.\nSay who it's for.";
    const html = renderToStaticMarkup(
      createElement(DocRead, {
        blocks: [{ id: "p1", kind: "paragraph", text } as Block],
      }),
    );
    // The text reaches the page as saved; the doc-line style shows its breaks.
    expect(html).toContain(
      `<span class="doc-line">Use plain words.\nKeep each line short.\nSay who it&#x27;s for.</span>`,
    );
  });
});
