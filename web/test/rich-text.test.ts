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

  it.each([
    ["username", "https://user@example.test/a"],
    ["username and password", "https://user:secret@example.test/a"],
    ["password only", "https://:secret@example.test/a"],
    ["encoded username", "https://%75ser@example.test/a"],
    ["missing host", "https://"],
    ["invalid host", "https://exa%mple.test/a"],
    ["invalid IPv6", "http://[::1/a"],
    ["invalid port", "https://example.test:invalid/a"],
    ["backslash in authority", "https://example.test\\@other.test/a"],
    ["backslash in path", "https://example.test/a\\b"],
    ["raw NUL", "https://example.test/a\u0000b"],
    ["raw escape", "https://example.test/a\u001bb"],
    ["raw DEL", "https://example.test/a\u007fb"],
    ["raw C1 control", "https://example.test/a\u0085b"],
  ])("keeps a link with %s as nonclickable label text", (_reason, href) => {
    expect(parseInline(`Before [site](${href}) after`)).toEqual([
      { t: "text", v: "Before site after" },
    ]);
  });

  it.each([
    "http://example.test/a",
    "https://example.test/path?q=one&next=two#section",
    "HTTPS://EXAMPLE.test:443/a%2fb?q=%41#Section",
    "http://example.test:8080/path?q=one#section",
    "https://[2001:db8::1]:8443/path?q=one#section",
    "http://[::1]/a",
    "https://example.test/a%5Cb?q=%00",
  ])("preserves the original href of a valid web link: %s", (href) => {
    expect(parseInline(`[site](${href})`)).toEqual([
      { t: "link", href, c: [{ t: "text", v: "site" }] },
    ]);
  });

  it.each([
    "/relative/path",
    "../relative/path",
    "//example.test/a",
    "mailto:reader@example.test",
    "ftp://example.test/a",
  ])("preserves the non-web link fallback: %s", (href) => {
    expect(parseInline(`[site](${href})`)).toEqual([{ t: "text", v: "site" }]);
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
