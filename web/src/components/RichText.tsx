"use client";
import { useState, type ReactNode } from "react";
import {
  parseBlocks,
  plainText,
  type Block,
  type Inline,
} from "@/lib/rich-text";

function inlines(c: Inline[], key = ""): ReactNode[] {
  return c.map((x, i) => {
    const k = `${key}${i}`;
    switch (x.t) {
      case "text":
        return x.v;
      case "code":
        return <code key={k}>{x.v}</code>;
      case "strong":
        return <strong key={k}>{inlines(x.c, k)}</strong>;
      case "em":
        return <em key={k}>{inlines(x.c, k)}</em>;
      case "link":
        return (
          <a
            key={k}
            href={x.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {inlines(x.c, k)}
          </a>
        );
    }
  });
}

function lines(c: Inline[][]): ReactNode[] {
  return c.flatMap((line, i) =>
    i
      ? [<br key={`br${i}`} />, ...inlines(line, `l${i}-`)]
      : inlines(line, "l0-"),
  );
}

function block(b: Block, i: number): ReactNode {
  switch (b.t) {
    case "p":
      return <p key={i}>{lines(b.c)}</p>;
    case "h":
      return (
        <p key={i} className="rich-heading">
          <strong>{inlines(b.c)}</strong>
        </p>
      );
    case "ul":
      return (
        <ul key={i}>
          {b.items.map((it, j) => (
            <li key={j}>{inlines(it)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={i} start={b.start}>
          {b.items.map((it, j) => (
            <li key={j}>{inlines(it)}</li>
          ))}
        </ol>
      );
    case "pre":
      return (
        <pre key={i} className="rich-code">
          <code>{b.v}</code>
        </pre>
      );
    case "quote":
      return <blockquote key={i}>{lines(b.c)}</blockquote>;
    case "table":
      return (
        <div
          key={i}
          className="rich-table"
          tabIndex={0}
          role="region"
          aria-label="Table"
        >
          <table>
            <thead>
              <tr>
                {b.head.map((h, j) => (
                  <th key={j} scope="col">
                    {inlines(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j}>
                  {r.map((cell, k) => (
                    <td key={k}>{inlines(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function length(b: Block): number {
  switch (b.t) {
    case "p":
    case "quote":
      return b.c.reduce((n, l) => n + plainText(l).length, 0);
    case "h":
      return plainText(b.c).length;
    case "ul":
    case "ol":
      return b.items.reduce((n, it) => n + plainText(it).length + 20, 0);
    case "pre":
      return b.v.length;
    case "table":
      return 200 + b.rows.length * 40;
  }
}

/**
 * A reply read as text: emphasis, lists, code and tables render; nothing in
 * the reply becomes HTML. A long reply opens with its first part and the
 * rest is one click away.
 */
export function RichText({
  text,
  budget = 600,
}: {
  text: string;
  /** About how many characters show before "Show more". */
  budget?: number;
}) {
  const [open, setOpen] = useState(false);
  const blocks = parseBlocks(text);
  let shown = blocks.length;
  let used = 0;
  for (let i = 0; i < blocks.length; i++) {
    used += length(blocks[i]!);
    if (used > budget && i > 0) {
      shown = i;
      break;
    }
  }
  // Only fold when there is a meaningful remainder.
  const folds = shown < blocks.length;
  return (
    <div className="rich-text">
      {(open || !folds ? blocks : blocks.slice(0, shown)).map(block)}
      {folds ? (
        <button
          type="button"
          className="link-quiet small rich-more"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
