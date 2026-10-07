/**
 * A small, safe reading of the Markdown that model replies tend to use, so
 * they read as text rather than syntax. It only produces data; rendering
 * builds React elements from it, so nothing in a reply becomes HTML.
 */
export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] };

export type Block =
  | { t: "p"; c: Inline[][] } // lines within one paragraph
  | { t: "h"; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "pre"; v: string }
  | { t: "quote"; c: Inline[][] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] };

const BULLET = /^\s{0,3}[-*•+]\s+(.*)$/;
const NUMBER = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}(```|~~~)/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^`([^`]+)`/))) {
      flush();
      out.push({ t: "code", v: m[1]! });
    } else if ((m = rest.match(/^\*\*(?=\S)(.+?)(?<=\S)\*\*/))) {
      flush();
      out.push({ t: "strong", c: parseInline(m[1]!) });
    } else if ((m = rest.match(/^__(?=\S)(.+?)(?<=\S)__/))) {
      flush();
      out.push({ t: "strong", c: parseInline(m[1]!) });
    } else if (
      // Emphasis only at word boundaries, so arithmetic like 3*1250*2 and
      // snake_case names stay as written.
      (i === 0 || !/[A-Za-z0-9]/.test(src[i - 1]!)) &&
      ((m = rest.match(/^\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![A-Za-z0-9])/)) ||
        (m = rest.match(/^_(?=[^\s_])(.+?)(?<=[^\s_])_(?![A-Za-z0-9])/)))
    ) {
      flush();
      out.push({ t: "em", c: parseInline(m[1]!) });
    } else if ((m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) {
      flush();
      const href = m[2]!;
      // Only ordinary web links become links; anything else stays text.
      if (/^https?:\/\//i.test(href))
        out.push({ t: "link", href, c: parseInline(m[1]!) });
      else out.push(...parseInline(m[1]!));
    } else {
      text += src[i];
      i += 1;
      continue;
    }
    i += m[0].length;
  }
  flush();
  // Adjacent text pieces read as one.
  return out.reduce<Inline[]>((acc, x) => {
    const last = acc[acc.length - 1];
    if (x.t === "text" && last?.t === "text") last.v += x.v;
    else acc.push(x);
    return acc;
  }, []);
}

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || RULE.test(line)) {
      i += 1;
      continue;
    }
    if (FENCE.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      i += 1; // closing fence (or end)
      blocks.push({ t: "pre", v: body.join("\n") });
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(HEADING))) {
      blocks.push({ t: "h", c: parseInline(m[1]!) });
      i += 1;
      continue;
    }
    if (line.includes("|") && TABLE_SEP.test(lines[i + 1] ?? "")) {
      const head = cells(line).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim())
        rows.push(cells(lines[i++]!).map(parseInline));
      blocks.push({ t: "table", head, rows });
      continue;
    }
    if (BULLET.test(line) || NUMBER.test(line)) {
      const ordered = !BULLET.test(line);
      const start = ordered ? Number(line.match(NUMBER)![1]) : 1;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        const b = ordered ? l.match(NUMBER)?.[2] : l.match(BULLET)?.[1];
        if (b !== undefined) items.push(parseInline(b));
        else if (l.trim() && /^\s{2,}\S/.test(l) && items.length)
          // A wrapped continuation line belongs to the previous item.
          items[items.length - 1]!.push(
            { t: "text", v: " " },
            ...parseInline(l.trim()),
          );
        else break;
        i += 1;
      }
      blocks.push(ordered ? { t: "ol", start, items } : { t: "ul", items });
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const quoted: Inline[][] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i]!))
        quoted.push(parseInline(lines[i++]!.replace(/^\s{0,3}>\s?/, "")));
      blocks.push({ t: "quote", c: quoted });
      continue;
    }
    const para: Inline[][] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !FENCE.test(lines[i]!) &&
      !HEADING.test(lines[i]!) &&
      !BULLET.test(lines[i]!) &&
      !NUMBER.test(lines[i]!) &&
      !RULE.test(lines[i]!) &&
      !(lines[i]!.includes("|") && TABLE_SEP.test(lines[i + 1] ?? ""))
    )
      para.push(parseInline(lines[i++]!.trim()));
    blocks.push({ t: "p", c: para });
  }
  return blocks;
}

/** Plain text of some inlines, for length checks and previews. */
export function plainText(c: Inline[]): string {
  return c
    .map((x) => (x.t === "text" || x.t === "code" ? x.v : plainText(x.c)))
    .join("");
}
