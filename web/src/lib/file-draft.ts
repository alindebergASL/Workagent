import { scopedSession } from "@/lib/client/session-scope";
import { toDisplayText } from "@/lib/files-contract";

/**
 * Per-tab safety copy of an unsaved file edit, in the same spirit as
 * lib/draft.ts: it survives panel switches and an accidental reload, it is
 * keyed to the exact base version + hash the edit started from, and it is
 * cleared when the save is acknowledged. It is not application persistence.
 */
export interface FileDraftRecord {
  workspace_file_id: string;
  base_version_id: string;
  base_sha256: string;
  content: string;
  saved_at: string;
}

function key(fileId: string): string {
  return `workagent:file-draft:${fileId}`;
}

export function readFileDraft(fileId: string): FileDraftRecord | null {
  try {
    const raw = scopedSession.getItem(key(fileId));
    return raw ? (JSON.parse(raw) as FileDraftRecord) : null;
  } catch {
    return null;
  }
}

export function writeFileDraft(rec: FileDraftRecord): void {
  try {
    scopedSession.setItem(key(rec.workspace_file_id), JSON.stringify(rec));
  } catch {
    /* storage unavailable: the in-memory draft still exists */
  }
}

export function clearFileDraft(fileId: string): void {
  try {
    scopedSession.removeItem(key(fileId));
  } catch {
    /* ignore */
  }
}

/**
 * Resolution of a failed create/save attempt for a journaled command.
 * `ambiguousNow` is whether this failure's outcome is unknown; `everAmbiguous`
 * is whether any earlier attempt's was (including a journal restored after a
 * reload). Once a command has ever been ambiguous, the earlier attempt may
 * have committed, so even a later definitive refusal keeps the journal:
 * replaying that exact envelope stays the only way forward, and a fresh
 * command — a possible duplicate effect — is never offered.
 */
export function failedWriteOutcome(
  ambiguousNow: boolean,
  everAmbiguous: boolean,
): { keepPending: boolean; unknownOutcome: boolean } {
  const unknown = ambiguousNow || everAmbiguous;
  return { keepPending: unknown, unknownOutcome: unknown };
}

/**
 * True when a stored draft is exactly the generation a journaled save sent:
 * the same exact base version and bytes, and the same text the envelope
 * carries. Only this generation may be cleared by that save's
 * acknowledgement; a draft holding different text — newer edits, or one kept
 * from an earlier version — is never cleared by it.
 */
export function draftMatchesSavedBody(
  draft: FileDraftRecord,
  body: { base_version_id: string; base_sha256: string; content: string },
): boolean {
  return (
    draftMatchesBase(draft, body.base_version_id, body.base_sha256) &&
    draft.content === toDisplayText(body.content)
  );
}

/**
 * A draft only re-enters the editor when it was based on the same exact
 * version and bytes. A stale draft is still shown as recoverable text, but a
 * newer server version never silently replaces it, and it never silently
 * rebases onto a moved head.
 */
export function draftMatchesBase(
  draft: FileDraftRecord,
  baseVersionId: string,
  baseSha256: string,
): boolean {
  return (
    draft.base_version_id === baseVersionId && draft.base_sha256 === baseSha256
  );
}
