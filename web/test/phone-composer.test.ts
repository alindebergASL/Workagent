import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// On a 390×900 phone a long multiline draft grew the docked reply box over
// most of the transcript. The box is now contained and scrolls inside; the
// draft itself is untouched (it stays in the textarea's value).
const read = (p: string) =>
  readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} rule`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
}

const vh = (r: string) =>
  [...r.matchAll(/max-height:\s*(\d+)d?vh/g)].map((m) => Number(m[1]));

describe("docked phone reply box with a long draft", () => {
  const css = read("../src/styles/phone.css");
  const page = read("../src/app/conversations/[id]/page.tsx");

  it("keeps the whole box under half the screen and scrolls inside it", () => {
    const r = rule(css, "  .conversation-page > .conversation-ask");
    expect(r).toMatch(/position:\s*sticky/);
    expect(r).toMatch(/max-height:\s*45dvh/);
    expect(Math.max(...vh(r))).toBeLessThanOrEqual(50);
    expect(r).toMatch(/overflow-y:\s*auto/);
    expect(r).toMatch(/overscroll-behavior:\s*contain/);
    // Never clipped away: the draft and notes stay reachable.
    expect(r).not.toMatch(/overflow(-y)?:\s*hidden/);
  });

  it("caps the field below the box so the controls stay in view", () => {
    const r = rule(css, "  .conversation-page > .conversation-ask > textarea");
    expect(Math.max(...vh(r))).toBeLessThan(45);
    expect(r).toMatch(/overflow-y:\s*auto/);
  });

  it("the box stays in the page flow (no fixed overlay needing clearance)", () => {
    const r = rule(css, "  .conversation-page > .conversation-ask");
    expect(r).not.toMatch(/position:\s*fixed/);
    // The grow-with-text sizing still only sets height; the text is kept.
    expect(page).toMatch(
      /el\.style\.height = `\$\{Math\.max\(el\.scrollHeight, 56\)\}px`/,
    );
    expect(page).toMatch(/value=\{text\}/);
  });
});
