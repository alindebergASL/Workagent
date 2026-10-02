"use client";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { Block } from "@/lib/contract/types";
import { condenseDiff, type DiffItem, type DiffOp } from "@/lib/diff";

export function DocRead({
  blocks,
  onSourceMark,
  idPrefix = "r",
}: {
  blocks: Block[];
  onSourceMark?: (sourceId: string) => void;
  idPrefix?: string;
}) {
  return (
    <div className="doc">
      {blocks.map((b) => (
        <div
          className="doc-block"
          data-kind={b.kind}
          key={`${idPrefix}-${b.id}`}
        >
          <div className="doc-text">
            {b.kind === "check_item" ? (
              <input
                type="checkbox"
                checked={Boolean(b.checked)}
                readOnly
                aria-label={`${b.text} (${b.checked ? "done" : "not done"})`}
                tabIndex={-1}
              />
            ) : null}
            {b.kind === "heading" ? <h3>{b.text}</h3> : <span>{b.text}</span>}
          </div>
          <SourceMarks block={b} onSourceMark={onSourceMark} />
        </div>
      ))}
    </div>
  );
}

function SourceMarks({
  block,
  onSourceMark,
}: {
  block: Block;
  onSourceMark?: (id: string) => void;
}) {
  if (!block.source_ids?.length) return <span />;
  return (
    <div className="doc-marks" aria-label="Sources for this block">
      {block.source_ids.map((sid) =>
        onSourceMark ? (
          <button
            type="button"
            key={sid}
            className="mark"
            onClick={() => onSourceMark(sid)}
            title={`Open source ${sid}`}
          >
            {sid}
          </button>
        ) : (
          <span key={sid} className="mark">
            {sid}
          </span>
        ),
      )}
    </div>
  );
}

export function DocEdit({
  blocks,
  onChange,
  disabled = false,
}: {
  blocks: Block[];
  onChange: (next: Block[]) => void;
  disabled?: boolean;
}) {
  const update = useCallback(
    (id: string, patch: Partial<Block>) => {
      onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    },
    [blocks, onChange],
  );
  return (
    <div className="doc">
      {blocks.map((b) => (
        <div className="doc-block" data-kind={b.kind} key={b.id}>
          <div className="doc-text">
            {b.kind === "check_item" ? (
              <input
                type="checkbox"
                checked={Boolean(b.checked)}
                disabled={disabled}
                onChange={(e) => update(b.id, { checked: e.target.checked })}
                aria-label={`Mark done: ${b.text}`}
              />
            ) : null}
            <AutoTextarea
              label={`${labelFor(b.kind)} ${b.id}`}
              value={b.text}
              disabled={disabled}
              onChange={(text) => update(b.id, { text })}
            />
          </div>
          <SourceMarks block={b} />
        </div>
      ))}
    </div>
  );
}

/** Grows with its content; re-measures when a hidden pane becomes visible. */
function AutoTextarea({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el || el.offsetWidth === 0) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, []);
  useLayoutEffect(fit, [value, fit]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (el.offsetWidth !== width) {
        width = el.offsetWidth;
        fit();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);
  return (
    <textarea
      ref={ref}
      aria-label={label}
      value={value}
      disabled={disabled}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function labelFor(kind: Block["kind"]): string {
  switch (kind) {
    case "heading":
      return "Heading";
    case "paragraph":
      return "Paragraph";
    case "list_item":
      return "List item";
    case "check_item":
      return "Checklist item";
  }
}

export interface DiffLabels {
  added: string;
  removed: string;
  /** "edit": removed text is struck through. "compare": two versions side by side, nothing is struck. */
  tone?: "edit" | "compare";
}

const EDIT_LABELS: DiffLabels = {
  added: "Added",
  removed: "Removed",
  tone: "edit",
};

export function DocDiff({
  ops,
  labels = EDIT_LABELS,
  condensed = true,
}: {
  ops: DiffOp[];
  labels?: DiffLabels;
  condensed?: boolean;
}) {
  const items: DiffItem[] = condensed ? condenseDiff(ops) : ops;
  const tone = labels.tone ?? "edit";
  return (
    <div className="diff" data-tone={tone}>
      <p className="diff-legend" aria-hidden="true">
        <span className="swatch swatch-added" /> {labels.added}
        <span className="swatch swatch-removed" /> {labels.removed}
      </p>
      <div className="doc" aria-label="Exact changes">
        {items.map((op, i) =>
          op.type === "gap" ? (
            <p className="diff-gap" key={`gap-${i}`}>
              {op.count} unchanged line{op.count === 1 ? "" : "s"}
            </p>
          ) : (
            <div
              className="doc-block"
              data-kind={op.block.kind}
              data-added={op.type === "added" ? "true" : undefined}
              data-removed={op.type === "removed" ? "true" : undefined}
              key={`${op.type}-${op.block.id}-${i}`}
            >
              <div className="doc-text">
                <span className="sr-only">
                  {op.type === "added"
                    ? `${labels.added}: `
                    : op.type === "removed"
                      ? `${labels.removed}: `
                      : ""}
                </span>
                {op.block.kind === "check_item" ? (
                  <span className="diff-check">
                    {op.block.checked ? "☑ Done · " : "☐ Not done · "}
                  </span>
                ) : null}
                {op.block.kind === "heading" ? (
                  <h3>{op.block.text}</h3>
                ) : (
                  <span>{op.block.text}</span>
                )}
              </div>
              <span />
            </div>
          ),
        )}
      </div>
    </div>
  );
}
