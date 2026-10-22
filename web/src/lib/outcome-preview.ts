/** Longest outcome said whole before the rest is a step away. */
const WHOLE = 180;
/** Longest first sentence shown before it is cut at a word. */
const LEAD = 160;

/**
 * The start of a recorded outcome, in its own words: its first sentence, or
 * the whole of it when short. Nothing is rewritten; `more` says there is
 * more to read, which the page keeps one step away.
 */
export function outcomePreview(text: string): { lead: string; more: boolean } {
  const whole = text.trim();
  if (whole.length <= WHOLE) return { lead: whole, more: false };
  const first = /^[\s\S]+?[.!?](?=\s)/.exec(whole)?.[0] ?? whole;
  if (first.length <= LEAD) return { lead: first, more: true };
  const cut = first.slice(0, LEAD);
  const space = cut.lastIndexOf(" ");
  return {
    lead: `${(space > LEAD / 2 ? cut.slice(0, space) : cut).trimEnd()}…`,
    more: true,
  };
}
