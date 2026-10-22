import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { outcomePreview } from "../src/lib/outcome-preview";
import { OutcomeLede } from "../src/components/OutcomeLede";

const LONG =
  "Prepared a source-linked newsletter draft from the W3C writing guidance and saved it in the conversation. " +
  "Publication checked shape only; nobody has reviewed the wording or confirmed it reads well for the audience. " +
  "The next pass will compare it with the house style once that is supplied.";

describe("a recorded outcome, concise first", () => {
  it("says a short outcome whole", () => {
    expect(outcomePreview("A draft is saved. Nothing was sent.")).toEqual({
      lead: "A draft is saved. Nothing was sent.",
      more: false,
    });
  });
  it("leads a long one with its first sentence, word for word", () => {
    const p = outcomePreview(LONG);
    expect(p.more).toBe(true);
    expect(p.lead).toBe(
      "Prepared a source-linked newsletter draft from the W3C writing guidance and saved it in the conversation.",
    );
    expect(LONG.startsWith(p.lead)).toBe(true);
  });
  it("cuts a very long first sentence at a word, marked as cut", () => {
    const run = `${"word ".repeat(60).trim()}. Then more.`;
    const p = outcomePreview(run);
    expect(p.more).toBe(true);
    expect(p.lead.endsWith("word…")).toBe(true);
    expect(p.lead.length).toBeLessThanOrEqual(161);
  });
  it("keeps the rest one click away, not dropped", () => {
    const html = renderToStaticMarkup(
      createElement(OutcomeLede, { text: LONG }),
    );
    expect(html).toContain("in the conversation.");
    expect(html).not.toContain("Publication checked shape only");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Read all of it");
    const short = renderToStaticMarkup(
      createElement(OutcomeLede, { text: "A draft is saved." }),
    );
    expect(short).not.toContain("<button");
  });
});
