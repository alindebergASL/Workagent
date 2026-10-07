import { describe, expect, it } from "vitest";
import { parseBlocks, parseInline, plainText } from "../src/lib/rich-text";

describe("reading model replies as text, not syntax", () => {
  it("parses emphasis, code and only http(s) links", () => {
    expect(
      parseInline("A **bold** and *soft* `x = 1` [site](https://e.test/a)"),
    ).toEqual([
      { t: "text", v: "A " },
      { t: "strong", c: [{ t: "text", v: "bold" }] },
      { t: "text", v: " and " },
      { t: "em", c: [{ t: "text", v: "soft" }] },
      { t: "text", v: " " },
      { t: "code", v: "x = 1" },
      { t: "text", v: " " },
      { t: "link", href: "https://e.test/a", c: [{ t: "text", v: "site" }] },
    ]);
    // A non-web link is never a link; its text stays plain.
    expect(parseInline("[x](javascript:alert(1))")).toEqual([
      { t: "text", v: "x)" },
    ]);
    expect(parseInline("snake_case_name and 2*3*4")).toEqual([
      { t: "text", v: "snake_case_name and 2*3*4" },
    ]);
    expect(parseInline("<script>alert(1)</script>")).toEqual([
      { t: "text", v: "<script>alert(1)</script>" },
    ]);
  });

  it("parses paragraphs, headings, lists, code, quotes and tables", () => {
    const blocks = parseBlocks(
      [
        "## Result",
        "Reported total **78.40**, calculated 77.40.",
        "Second line.",
        "",
        "- Row B is off by 1.00",
        "  because of rounding",
        "* Notes kept",
        "",
        "2. Review",
        "3. Apply",
        "",
        "```",
        "(module)",
        "```",
        "> It's a proposal.",
        "",
        "| Row | Diff |",
        "|---|---:|",
        "| B | 1.00 |",
        "---",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.t)).toEqual([
      "h",
      "p",
      "ul",
      "ol",
      "pre",
      "quote",
      "table",
    ]);
    const ul = blocks[2] as Extract<(typeof blocks)[number], { t: "ul" }>;
    expect(ul.items.map(plainText)).toEqual([
      "Row B is off by 1.00 because of rounding",
      "Notes kept",
    ]);
    expect(blocks[3]).toMatchObject({ t: "ol", start: 2 });
    expect(blocks[4]).toEqual({ t: "pre", v: "(module)" });
    const table = blocks[6] as Extract<(typeof blocks)[number], { t: "table" }>;
    expect(table.head.map(plainText)).toEqual(["Row", "Diff"]);
    expect(table.rows[0]!.map(plainText)).toEqual(["B", "1.00"]);
  });

  it("keeps plain text as a single paragraph", () => {
    expect(parseBlocks("Just a reply.")).toEqual([
      { t: "p", c: [[{ t: "text", v: "Just a reply." }]] },
    ]);
  });
});
