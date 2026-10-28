"use client";
import { ATTACH_ACCEPT, type MessageAttachment } from "@/lib/contract/natural";
import type { AttachmentContextView } from "@/lib/contract/types";
import { contextNote } from "@/lib/attachment-context";

/**
 * A file name that keeps its extension when it has to be shortened, so two
 * long names that differ only in type stay distinguishable.
 */
export function FileName({ name }: { name: string }) {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return (
    <span className="file-name" title={name}>
      <span className="file-stem">{stem}</span>
      {ext ? <span className="file-ext">{ext}</span> : null}
    </span>
  );
}

/**
 * The files attached to a reply: each by name with a way to remove it, any
 * reason a file wasn't attached, and a picker. Files are read as text and
 * sent as data; nothing in them is run or followed.
 */
export function AttachedFiles({
  files,
  error,
  locked,
  onAdd,
  onRemove,
}: {
  files: MessageAttachment[];
  error: string;
  /** No change while a send is in flight or its outcome is unknown. */
  locked: boolean;
  onAdd: (list: FileList | null) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="composer-files" data-testid="reply-files">
      {files.map((f, i) => (
        <span className="file-chip" key={`${f.filename}:${i}`}>
          <FileName name={f.filename} />
          <button
            type="button"
            className="link-quiet small"
            aria-label={`Remove ${f.filename}`}
            disabled={locked}
            onClick={() => onRemove(i)}
          >
            Remove
          </button>
        </span>
      ))}
      <label
        className="chip-toggle file-pick"
        data-disabled={locked || files.length >= 2}
      >
        Attach a file
        <input
          type="file"
          className="sr-only"
          accept={ATTACH_ACCEPT}
          multiple
          disabled={locked || files.length >= 2}
          onChange={(e) => {
            onAdd(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {error ? (
        <p role="alert" className="small">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const size = (n: number) =>
  n < 1000 ? `${n} bytes` : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)} KB`;

/** The files a sent message carried, as the service recorded them. */
export function SentFiles({
  files,
}: {
  files?: { filename: string; byte_length: number; sha256: string }[];
}) {
  if (!files?.length) return null;
  return (
    <ul className="sent-files small muted" aria-label="Attached files">
      {files.map((f) => (
        <li key={f.sha256 + f.filename} title={`SHA-256 ${f.sha256}`}>
          {f.filename} · {size(f.byte_length)}
        </li>
      ))}
    </ul>
  );
}

/**
 * For each file omitted from the turn's bounded attachment context: that the
 * original is kept, and the exact byte ranges range receipts confirm were
 * read back. Files the bounded context held, and turns with no frozen
 * record, say nothing.
 */
export function FileContext({ items }: { items: AttachmentContextView[] }) {
  const notes = items.flatMap((a) => {
    const text = contextNote(a);
    return text ? [{ a, text }] : [];
  });
  if (!notes.length) return null;
  return (
    <ul
      className="sent-files small muted"
      aria-label="What Workagent read of attached files"
      data-testid="file-context"
    >
      {notes.map(({ a, text }) => (
        <li
          key={`${a.run_id}:${a.ref}`}
          title={`SHA-256 ${a.sha256}`}
          data-ranges={a.ranges.length || undefined}
        >
          <FileName name={a.filename} />: {text}
        </li>
      ))}
    </ul>
  );
}
