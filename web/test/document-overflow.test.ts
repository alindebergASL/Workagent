import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The text read from a document (e.g. a long XLSX formula line) is shown in a
// <pre>. Without wrapping it widened the documents section past a phone screen.
const read = (p: string) =>
  readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} rule`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
}

describe("retained document text on narrow screens", () => {
  const css = read("../src/styles/agent-first.css");
  const tsx = read("../src/components/Batch2Controls.tsx");

  it("wraps read text inside the column without truncating it", () => {
    const r = rule(css, ".document-read-text");
    expect(r).toMatch(/white-space:\s*pre-wrap/);
    expect(r).toMatch(/overflow-wrap:\s*anywhere/);
    expect(r).toMatch(/max-width:\s*100%/);
    expect(r).not.toMatch(/overflow:\s*hidden|text-overflow|max-height/);
  });

  it("lets the document row shrink and wrap long names", () => {
    const r = rule(css, ".document-row");
    expect(r).toMatch(/min-width:\s*0/);
    expect(r).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("uses those classes for the documents list", () => {
    expect(tsx).toMatch(/className="document-read-text small"/);
    expect(tsx).toMatch(/className="stack-xs document-row"/);
  });
});
