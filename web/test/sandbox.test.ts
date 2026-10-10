import { describe, expect, it } from "vitest";
import {
  buildViewDocument,
  readViewMessage,
  VIEW_CSP,
  VIEW_LIMITS,
  viewProblem,
} from "../src/lib/sandbox";
import { APP_SECURITY_HEADERS } from "../src/lib/security-headers.mjs";

describe("agent-created view boundary", () => {
  it("puts the no-network policy before any generated markup", () => {
    const doc = buildViewDocument({
      html: "<p>hi</p>",
      css: "p{color:red}</style><script>x</script>",
      js: "1</script><script>evil()",
    });
    expect(doc.indexOf(`content="${VIEW_CSP}"`)).toBeGreaterThan(0);
    expect(doc.indexOf(VIEW_CSP)).toBeLessThan(doc.indexOf("<p>hi</p>"));
    expect(VIEW_CSP).toContain("default-src 'none'");
    expect(VIEW_CSP).toContain("connect-src 'none'");
    expect(VIEW_CSP).not.toMatch(/https?:|\*/);
    // Generated style/script can't close its own element.
    expect(doc).toContain("p{color:red}<\\/style>");
    expect(doc).toContain("1<\\/script><script>evil()");
    // Exactly our own closing tags remain: the base and view <style>, the
    // bootstrap and view <script>. (A "</script>" inside style text is inert.)
    expect(doc.match(/<\/style>/g)!.length).toBe(2);
    expect(doc.endsWith("evil()</script></body></html>")).toBe(true);
  });

  it("reads only bounded, well-formed messages and always answers requests", () => {
    expect(readViewMessage(null)).toBeNull();
    expect(readViewMessage("resize")).toBeNull();
    expect(readViewMessage([1])).toBeNull();
    expect(readViewMessage({ type: "resize", height: 99999 })).toEqual({
      type: "resize",
      height: VIEW_LIMITS.maxHeight,
    });
    expect(readViewMessage({ type: "resize", height: -5 })).toEqual({
      type: "resize",
      height: VIEW_LIMITS.minHeight,
    });
    expect(readViewMessage({ type: "resize", height: NaN })).toBeNull();
    expect(readViewMessage({ type: "request", id: 0, action: "a" })).toBeNull();
    expect(
      readViewMessage({ type: "request", id: 1.5, action: "a" }),
    ).toBeNull();
    expect(
      readViewMessage({
        type: "request",
        id: 1,
        action: "save_row",
        payload: { a: 1 },
      }),
    ).toEqual({
      type: "request",
      id: 1,
      action: "save_row",
      payload: { a: 1 },
    });
    for (const bad of ["__proto__", "Save", "", "a b", 7, "x".repeat(65)])
      expect(
        readViewMessage({ type: "request", id: 2, action: bad }),
      ).toMatchObject({
        id: 2,
        action: "",
      });
    expect(
      readViewMessage({
        type: "request",
        id: 3,
        action: "a",
        payload: "x".repeat(70_000),
      }),
    ).toMatchObject({ id: 3, refused: "That request is too large." });
    const cyclic: Record<string, unknown> = {
      type: "request",
      id: 4,
      action: "a",
    };
    cyclic["self"] = cyclic;
    expect(readViewMessage(cyclic)).toMatchObject({
      id: 4,
      refused: expect.any(String),
    });
  });

  it("refuses views and data that are too large", () => {
    expect(viewProblem({ html: "<p>ok</p>" }, { a: 1 })).toBeNull();
    expect(
      viewProblem({ html: "x".repeat(VIEW_LIMITS.sourceBytes + 1) }, {}),
    ).toMatch("too large");
    expect(
      viewProblem({ html: "" }, { big: "x".repeat(VIEW_LIMITS.dataBytes) }),
    ).toMatch("too large");
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(viewProblem({ html: "" }, cyclic)).toMatch("can’t be shown");
  });

  it("serves the frame policy that stops views navigating away", () => {
    expect(APP_SECURITY_HEADERS).toContainEqual({
      key: "Content-Security-Policy",
      value: "frame-src 'self'",
    });
  });
});
