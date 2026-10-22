/**
 * Where a conversation opens on a phone. It lands at its latest exchange,
 * the request at the top of the screen so a long reply reads from its
 * start, unless the person arrived somewhere on purpose: a link to a place
 * in it, a step back or forward through history (the browser restores that
 * position), or a page already scrolled. Focus never moves.
 */

let fromHistory = false;
if (typeof window !== "undefined") {
  // Back or forward is a history step with no click in the page; any click
  // (a link, a button that navigates) makes the next arrival deliberate.
  window.addEventListener("popstate", () => {
    fromHistory = true;
  });
  document.addEventListener(
    "click",
    () => {
      fromHistory = false;
    },
    true,
  );
}

/** Settling time while work cards above the target finish loading. */
const SETTLE_MS = 2000;

export function landAtLatest(
  target: HTMLElement | null,
  options: { purposeful: boolean },
): () => void {
  const none = () => {};
  if (
    !target ||
    options.purposeful ||
    fromHistory ||
    window.scrollY > 0 ||
    !window.matchMedia("(max-width: 640px)").matches
  )
    return none;
  // Already near the top of the screen: nothing to move.
  if (target.getBoundingClientRect().top < window.innerHeight / 3) return none;
  const align = () => target.scrollIntoView({ block: "start" });
  align();
  // Earlier work cards can grow as their states load and push the request
  // down; keep it in place briefly, until the person does anything.
  let done = false;
  const observer = new ResizeObserver(() => {
    if (!done) align();
  });
  observer.observe(document.body);
  const stop = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    clearTimeout(timer);
    for (const e of HANDS) window.removeEventListener(e, stop, true);
  };
  const timer = setTimeout(stop, SETTLE_MS);
  for (const e of HANDS)
    window.addEventListener(e, stop, { capture: true, passive: true });
  return stop;
}

/** Anything the person does that means they're steering the page now. */
const HANDS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
