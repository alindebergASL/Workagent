"use client";
import { useCallback } from "react";
import type { Block } from "@/lib/contract/types";
import type { DiffOp } from "@/lib/diff";

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
            <textarea
              aria-label={`${labelFor(b.kind)} ${b.id}`}
              value={b.text}
              disabled={disabled}
              rows={Math.max(1, Math.ceil(b.text.length / 70))}
              onChange={(e) => update(b.id, { text: e.target.value })}
            />
          </div>
          <SourceMarks block={b} />
        </div>
      ))}
    </div>
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

export function DocDiff({ ops }: { ops: DiffOp[] }) {
  return (
    <div
      className="doc"
      aria-label="Changes between the current version and the proposal"
    >
      {ops.map((op, i) => (
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
                ? "Added: "
                : op.type === "removed"
                  ? "Removed: "
                  : ""}
            </span>
            {op.block.kind === "heading" ? (
              <h3>{op.block.text}</h3>
            ) : (
              <span>{op.block.text}</span>
            )}
          </div>
          <span />
        </div>
      ))}
    </div>
  );
}
