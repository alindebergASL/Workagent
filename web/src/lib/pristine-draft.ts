/**
 * Whether a draft left behind by an advancing saved version carries no human
 * work: no write pending or journaled, nothing typed outside the body, and a
 * body identical (after the editor's own normalization) to the revision it
 * was based on, as read from the loaded history.
 *
 * Such a draft follows the worker's new saved version instead of claiming
 * unsaved edits or a conflict for work the person didn't do. Any other draft
 * is kept exactly as it is — including when its base revision isn't in the
 * history read, where pristineness can't be proven.
 */
export function pristineBehind<B>(
  draft: { base: string; body: B; pending: unknown },
  currentRevisionId: string,
  history: { id: string; body: unknown }[],
  options?: { touched?: boolean; normalize?: (body: B) => unknown },
): boolean {
  if (draft.base === currentRevisionId) return false;
  if (draft.pending || options?.touched) return false;
  const base = history.find((r) => r.id === draft.base);
  if (!base) return false;
  const normalize = options?.normalize ?? ((body: B) => body);
  return (
    JSON.stringify(normalize(draft.body)) ===
    JSON.stringify(normalize(base.body as B))
  );
}
