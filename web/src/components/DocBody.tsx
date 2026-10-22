"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
          data-note={b.backend_kind === "protected_note" || undefined}
          key={`${idPrefix}-${b.id}`}
        >
          {b.backend_kind === "protected_note" ? (
            <span className="doc-note-label">{noteLabel(b)}</span>
          ) : null}
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
            {b.kind === "heading" ? (
              <h3>{b.text}</h3>
            ) : (
              <span className="doc-line">{b.text}</span>
            )}
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

/**
 * A kept note says who added it only where the saved history shows that: the
 * person's own, or Workagent's (which may quote the person but isn't theirs).
 */
export function noteLabel(b: Block): string {
  return b.note_by === "human"
    ? "Your note"
    : b.note_by === "worker"
      ? "Note from Workagent"
      : "Note";
}

const ADDABLE: {
  kind: Block["kind"];
  backend: Block["backend_kind"];
  label: string;
}[] = [
  { kind: "paragraph", backend: "paragraph", label: "Paragraph" },
  { kind: "check_item", backend: "checklist", label: "Checklist item" },
  { kind: "paragraph", backend: "protected_note", label: "Your note" },
];

/** A new part's id: unique, and in the saved form's allowed characters. */
function newBlockId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function DocEdit({
  blocks,
  onChange,
  disabled = false,
  addable = false,
}: {
  blocks: Block[];
  onChange: (next: Block[]) => void;
  disabled?: boolean;
  /** The person can add parts (including their own notes) and remove them. */
  addable?: boolean;
}) {
  const update = useCallback(
    (id: string, patch: Partial<Block>) => {
      onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    },
    [blocks, onChange],
  );
  // A part just added takes the cursor once it's on screen.
  const [focusId, setFocusId] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusId) return;
    root.current
      ?.querySelector<HTMLTextAreaElement>(`[data-block="${focusId}"] textarea`)
      ?.focus();
    setFocusId(null);
  }, [focusId, blocks]);
  const add = (kind: Block["kind"], backend: Block["backend_kind"]) => {
    const id = newBlockId();
    onChange([
      ...blocks,
      {
        id,
        kind,
        text: "",
        backend_kind: backend,
        ...(backend === "checklist" ? { checked: false } : {}),
        ...(backend === "protected_note" ? { note_by: "human" as const } : {}),
      },
    ]);
    setFocusId(id);
  };
  // The last part removed, so one click puts it back where it was.
  const [removed, setRemoved] = useState<{ block: Block; at: number } | null>(
    null,
  );
  const remove = (id: string) => {
    const i = blocks.findIndex((b) => b.id === id);
    if (i >= 0) setRemoved({ block: blocks[i]!, at: i });
    onChange(blocks.filter((b) => b.id !== id));
    const next = blocks[i + 1] ?? blocks[i - 1];
    if (next) setFocusId(next.id);
  };
  const undo = () => {
    if (!removed || blocks.some((b) => b.id === removed.block.id)) {
      setRemoved(null);
      return;
    }
    const at = Math.min(removed.at, blocks.length);
    onChange([...blocks.slice(0, at), removed.block, ...blocks.slice(at)]);
    setFocusId(removed.block.id);
    setRemoved(null);
  };
  return (
    <div className="doc doc-editable" ref={root}>
      {blocks.map((b) => (
        <div
          className="doc-block"
          data-kind={b.kind}
          data-note={b.backend_kind === "protected_note" || undefined}
          data-block={b.id}
          key={b.id}
        >
          {b.backend_kind === "protected_note" ? (
            <span className="doc-note-label">{noteLabel(b)}</span>
          ) : null}
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
              label={`${b.backend_kind === "protected_note" ? noteLabel(b) : labelFor(b.kind)} ${b.id}`}
              value={b.text}
              disabled={disabled}
              onChange={(text) => update(b.id, { text })}
            />
            {addable && blocks.length > 1 ? (
              <button
                type="button"
                className="doc-remove"
                disabled={disabled}
                aria-label={`Remove ${b.backend_kind === "protected_note" ? noteLabel(b).replace(/^Your/, "your").replace(/^Note/, "note") : labelFor(b.kind).toLowerCase()}: ${b.text.slice(0, 40) || "empty"}`}
                onClick={() => remove(b.id)}
              >
                ×
              </button>
            ) : null}
          </div>
          <SourceMarks block={b} />
        </div>
      ))}
      {removed && !blocks.some((b) => b.id === removed.block.id) ? (
        <p className="small undo-line" role="status" data-testid="undo-remove">
          Removed “{removed.block.text.slice(0, 40) || "an empty part"}”.{" "}
          <button
            type="button"
            className="link-quiet"
            disabled={disabled}
            onClick={undo}
          >
            Undo
          </button>
        </p>
      ) : null}
      {addable && blocks.length < 200 ? (
        <div
          className="doc-add row wrap"
          role="group"
          aria-label="Add to the document"
        >
          <span className="small muted">Add</span>
          {ADDABLE.map((a) => (
            <button
              key={a.label}
              type="button"
              className="btn btn-sm btn-quiet"
              disabled={disabled}
              onClick={() => add(a.kind, a.backend)}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
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
                  <span className="doc-line">{op.block.text}</span>
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
