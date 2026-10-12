/**
 * A saved title as people read it. Titles are shown as written, except that
 * identifier-like words ("collected_litres") read as words and an
 * all-lowercase first word is capitalised, so a title made from a variable
 * name doesn't look like code. Words like "iPhone" are left alone. The saved
 * title is unchanged.
 */
export function readableTitle(title: string): string {
  const words = title.replace(
    /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g,
    (id) => id.replace(/_+/g, " ").toLowerCase(),
  );
  return /^[a-z]+\b/.test(words)
    ? words.charAt(0).toUpperCase() + words.slice(1)
    : words;
}
