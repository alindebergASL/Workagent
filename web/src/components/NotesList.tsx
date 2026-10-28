"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { editNotes, syncNotesUi, type NotesUi } from "@/lib/flexible";

/**
 * Keeps a text box as tall as its text, so it reads whole instead of
 * scrolling inside itself. Refits when the text changes or the box's width
 * does (a resize, a phone's card layout); its own height change isn't a
 * reason to measure again.
 */
export function useFitHeight(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    };
    fit();
    let width = el.clientWidth;
    const seen = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, [ref, value]);
}

function NoteBox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useFitHeight(ref, value);
  return (
    <textarea
      ref={ref}
      className="fit-text"
      rows={2}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Notes, each in its own box and saved exactly as typed: a note can run over
 * several lines. Only Add, Remove and the move buttons change how many notes
 * there are or their order. Over the limit, nothing is removed: it says so.
 */
export function NotesList({
  notes,
  max,
  onChange,
  label = "Notes",
}: {
  notes: string[];
  max: number;
  onChange: (notes: string[]) => void;
  label?: string;
}) {
  const headId = useId();
  // Each box keeps its identity while notes move, so typing and the cursor
  // stay with the note; the last note removed can be put back. A list
  // replaced from outside (a discard, a newer saved version) starts fresh.
  const seq = useRef(0);
  const next = () => `note-${++seq.current}`;
  const [ui, setUi] = useState<NotesUi>(() => ({
    source: notes,
    ids: notes.map(next),
    removed: null,
  }));
  const [focus, setFocus] = useState<string | null>(null);
  const synced = syncNotesUi(ui, notes, next);
  if (synced !== ui) {
    setUi(synced);
    setFocus(null);
  }
  const { ids: keys, removed } = synced;
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    root.current?.querySelector<HTMLElement>(focus)?.focus();
    setFocus(null);
  }, [focus, notes]);

  const change = (
    nextNotes: string[],
    nextIds: string[],
    nextRemoved: NotesUi["removed"] = removed,
  ) => {
    setUi({ source: nextNotes, ids: nextIds, removed: nextRemoved });
    onChange(nextNotes);
  };
  const setRemoved = (r: NotesUi["removed"]) =>
    setUi({ ...synced, removed: r });
  const add = () => {
    const id = next();
    change(editNotes.add(notes), [...keys, id]);
    setFocus(`[data-note-id="${id}"] textarea`);
  };
  const remove = (i: number) => {
    change(
      editNotes.remove(notes, i),
      keys.filter((_, j) => j !== i),
      { id: keys[i]!, text: notes[i]!, at: i },
    );
    // The cursor goes to the note that takes its place (or the one before),
    // never back to the top of the page with the button that was pressed.
    const near = keys[i + 1] ?? keys[i - 1];
    setFocus(near ? `[data-note-id="${near}"] textarea` : "[data-notes-add]");
  };
  const move = (i: number, by: -1 | 1) => {
    const to = i + by;
    const nextIds = [...keys];
    [nextIds[i], nextIds[to]] = [nextIds[to]!, nextIds[i]!];
    change(editNotes.move(notes, i, by), nextIds);
    // The note keeps the cursor on the button just used, or its other one
    // at the end of the list.
    const edge = to === 0 || to === notes.length - 1;
    setFocus(`[data-note-id="${keys[i]}"] [data-move="${edge ? -by : by}"]`);
  };
  const undo = () => {
    if (removed && !keys.includes(removed.id) && notes.length < max) {
      const at = Math.min(removed.at, notes.length);
      change(
        [...notes.slice(0, at), removed.text, ...notes.slice(at)],
        [...keys.slice(0, at), removed.id, ...keys.slice(at)],
        null,
      );
      setFocus(`[data-note-id="${removed.id}"] textarea`);
    } else setRemoved(null);
  };
  const short = (t: string) =>
    t.trim() ? `“${t.trim().slice(0, 40)}”` : "an empty note";

  return (
    <div
      className="field notes-list"
      role="group"
      aria-labelledby={headId}
      ref={root}
      data-testid="notes-list"
    >
      <span className="field-label" id={headId}>
        {label}
      </span>
      {notes.length ? (
        <ol className="notes-items">
          {notes.map((n, i) => (
            <li key={keys[i]} data-note-id={keys[i]} className="notes-item">
              <NoteBox
                label={`Note ${i + 1}`}
                value={n}
                onChange={(text) => change(editNotes.set(notes, i, text), keys)}
              />
              <div className="notes-item-actions row wrap">
                <button
                  type="button"
                  className="btn btn-sm"
                  data-move="-1"
                  disabled={i === 0}
                  aria-label={`Move note ${i + 1} up`}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  data-move="1"
                  disabled={i === notes.length - 1}
                  aria-label={`Move note ${i + 1} down`}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  aria-label={`Remove note ${i + 1}`}
                  onClick={() => remove(i)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="small muted">No notes.</p>
      )}
      {/* Always present, so what changes inside it is announced. */}
      <div role="status">
        {removed && !keys.includes(removed.id) ? (
          <p className="small undo-line" data-testid="notes-undo">
            Removed {short(removed.text)}.{" "}
            <button
              type="button"
              className="link-quiet"
              disabled={notes.length >= max}
              onClick={undo}
            >
              Undo
            </button>
          </p>
        ) : null}
      </div>
      <div className="row wrap">
        <button
          type="button"
          className="btn btn-sm"
          data-notes-add
          disabled={notes.length >= max}
          onClick={add}
        >
          Add a note
        </button>
        <span className="hint" data-testid="notes-hint">
          Each box is one note, saved exactly as written. Up to {max}.
        </span>
      </div>
    </div>
  );
}
