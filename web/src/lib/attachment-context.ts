import type {
  AttachmentContextView,
  ConversationDetailView,
} from "./contract/types";

/**
 * The frozen file context to show beside one message: under the request
 * that started the item's run (so a follow-up sent without re-attaching the
 * file still says what was read), or under the message that carried the
 * file when that run's request isn't in view.
 */
export function contextForMessage(
  detail: Pick<ConversationDetailView, "turns" | "attachment_context">,
  messageId: string,
): AttachmentContextView[] {
  return (detail.attachment_context ?? []).filter((a) => {
    const start = detail.turns.find((t) => t.run_id === a.run_id)?.message_id;
    return (start ?? a.message_id) === messageId;
  });
}

/** The byte ranges read back, merged and in order; empty reads dropped. */
export function readRanges(
  ranges: AttachmentContextView["ranges"],
): { offset: number; end: number }[] {
  const sorted = ranges
    .filter((r) => r.next_offset > r.offset)
    .sort((a, b) => a.offset - b.offset);
  const out: { offset: number; end: number }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.offset <= last.end)
      last.end = Math.max(last.end, r.next_offset);
    else out.push({ offset: r.offset, end: r.next_offset });
  }
  return out;
}

const n = (x: number) => x.toLocaleString("en");

/**
 * What to say about one file, from the frozen record only. `body_omitted`
 * describes the bounded attachment context snapshot, not every request the
 * provider saw, so this never says the file went unread elsewhere; ranges
 * are what range receipts confirm, never a claim the file was recovered in
 * full. Null when the bounded context held the file: nothing to qualify.
 */
export function contextNote(a: AttachmentContextView): string | null {
  if (!a.body_omitted) return null;
  const why =
    a.omission_reason === "size_limit"
      ? " It is larger than the bounded context's size limit."
      : "";
  const kept = `Original kept as sent; omitted from bounded attachment context.${why}`;
  const read = readRanges(a.ranges);
  if (!read.length) return kept;
  const total = read.reduce((s, r) => s + (r.end - r.offset), 0);
  const spans = read.map((r) => `${n(r.offset)}–${n(r.end)}`).join(", ");
  const unit = total === 1 ? "byte" : "bytes";
  return (
    `${kept} Read back ${n(total)} ${unit} of the original ` +
    `(bytes ${spans}, end exclusive). ` +
    `Only these ranges are confirmed by range receipts.`
  );
}
