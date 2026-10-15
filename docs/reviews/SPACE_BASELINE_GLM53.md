# Product Critique: WorkAgent Space Work View (DOM review)

## (1) Three perspectives

**Returning busy nontechnical user.** The page reads reasonably: "Saved work," "Work to read," "Current saved version · read-only here," and "Edit, review or refine this version" are plain-language. The "HUMAN SAVED" badge and "This chat follows the Space as a whole; no artifact is targeted" notice set expectations honestly. But the key warning appears only as prose *below* the chat affordance; a busy user may type into chat first, get a Space-level response, and only then discover they needed the artifact link. Statuses like "Ended" and "No context attached" are unexplained — a returning user won't know whether work stopped on purpose or failed. "Refresh saved work" implies staleness without saying what's stale. There is no summary of "what changed since you left."

**Analyst changing an assumption.** The model is right for this case: to change a number in the offer, the user must take the explicit artifact path, where revision/hash checks apply — the runtime correctly cannot revise the artifact from untargeted chat. That is a defensible safety design, and the page does surface the distinction. However, the cost is a two-hop detour (find artifact link → open → propose edit → human accepts), with no visible diff/proposal affordance on this page and no indication that prior assumptions are traceable (where does "three prospective clients" or the fixed fee live?). Changing one assumption across two artifacts ("Pilot next actions") shows no cross-artifact impact view.

**Mobile keyboard/screen-reader user.** At 390px and 320px there is no horizontal overflow — good. But many interactive elements have empty text and `aria: null` (six empty links on desktop, ~nine on mobile, plus an unlabeled button). A screen-reader user gets unlabeled links for what appear to be artifact cards; keyboard users can't distinguish them. The `<select>` for artifacts is keyboard-accessible, but its purpose is unlabeled ("Time zone" select at least has aria; the artifact select has none). Tappable targets like the 18–22px-high elements are below comfortable touch size. "More" nav on mobile hides destinations behind an unlabeled control.

## (2) Verdicts

- **Engineering: Pass (bounded).** 239 frontend + 32 operator tests pass; no overflow at 320/390px; state is clearly scoped. But no live Space probes and no accessibility tests — reliability of plumbing, not behavior.
- **Agency: Pass (bounded).** Targeted-artifact revision with hash checks plus human-authoritative saving is a sound agency model; untargeted chat correctly cannot mutate artifacts. Only chat-to-artifact routing is friction.
- **Usefulness: Not proven.** The fixture is a canceled pilot; the page shows *that* work exists and is saved, but not that it advances (no next-step affordances, no "what's left"). Engineering reliability ≠ usefulness, per the evidence given.
- **Experience: Mixed.** Honest, legible copy and read-only clarity are strengths; unlabeled controls, unexplained statuses, and the buried targeting warning are weaknesses.
- **Continuity: Bounded pass.** "Its history is kept," retained incomplete critiques, refresh affordance, and per-item provenance support durable work. But no diff/summary view means continuity is stored, not *surfaced*.
- **Ownership: Pass.** "HUMAN SAVED," human acceptance as authoritative, no connected accounts, no external actions — ownership boundaries are explicit and visible in-product.

## (3) Priority improvements (≤4)

1. **Label every interactive element.** Acceptance probe: automated a11y audit (axe) on desktop/390/320 reports zero unlabeled links/buttons; artifact cards expose names via aria-label.
2. **Surface chat-vs-artifact targeting before input.** Move/inline the "no artifact is targeted" notice adjacent to the chat composer, and offer a one-click "target the saved version" shortcut. Probe: the notice is within the chat region's DOM subtree; shortcut navigates to the artifact revision path with hash check intact.
3. **Explain statuses and staleness.** Tooltip/aria-description for "Ended," "No context attached," and what "Refresh saved work" checks. Probe: each status string has an associated description reachable by screen reader and hover.
4. **Add a "what changed since your last visit" summary line** on the Space page (no new state store — derive from existing saved-version records). Probe: returning-view fixture renders a change summary naming the newest saved version and its source.

## (4) Evidence limitations

- Static DOM/text snapshots only; no execution, no interaction, no screenshots reviewed here (Astra's visual review is separate and not incorporated).
- Single synthetic canceled fixture; cannot generalize to active Spaces, multi-artifact Spaces, or revision flows.
- No user research; the three perspectives are reasoned, not observed.
- No live Space probes, no accessibility test results, no latency/error-state evidence.
- Backend behavior (hash checks, human acceptance) is asserted by description, not observed in the DOM.
- Redesign in flight; findings may target a UI already being replaced.
