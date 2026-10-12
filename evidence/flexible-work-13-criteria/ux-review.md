# Independent criteria-view UX and generated-code review

## Verdict

**PASS for this new draft and the specified criteria-clarification scope. No P1/P2 blocker found.** The visible £350 match / original £300 non-qualification distinction is now understandable at the point of comparison, rather than relying on buried explanatory notes. This is not a claim that the original artifact was repaired, that all future model generations will comply, that the venues are verified, or that issue #13 is complete.

Reviewed application commit: `9a009c6467369716a5e1d0c0d6f3b83337a2da8a`, served by the separate exact worktree's production UI at `http://127.0.0.1:3163`.

Reviewed **new** artifact: `8f972d05-6e03-4095-9150-0a06eac1ede1`; revision `e8ecf826-2d32-462d-b96a-babe69626bf4`; body hash `7fc35005ed8feceadccfeac4ded0a93fbf9024f628a46647f33d50c51de50bbf`. The live revision was compared with the supplied generated-artifact record. Its bound replayed table body exactly matched the retained original table body. Before/after readback of the new view, replayed table, original table, and original view found unchanged current revisions.

Only this report and `.local/criteria-ux-review/` review files were written. No application/source fixes, save, acceptance, rebind, booking, provider call, merge, deployment, or tracked-work closure was performed.

## Independent execution and visible comparison

I read the exact generated HTML/CSS/JS and relevant trusted iframe/bridge code; drove a separately written Playwright review rather than merely rerunning the existing assertions; inspected actual screenshots; and opened the retained original artifact at £350 for a direct before/after comparison.

| Browser viewport | £300 | £350 | Refresh / reload / reopen / readable fallback |
|---|---|---|---|
| Desktop 1440 × 1000 | 0 of 4 match | Willow Hall and River Centre match | Passed |
| Phone 390 × 844 | 0 of 4 match | Willow Hall and River Centre match | Passed |
| Narrow phone 320 × 700 | 0 of 4 match | Willow Hall and River Centre match | Passed |

The six live cases are persisted in `criteria-ux-review/live-evidence.json`. All four cards were checked in every case for exact saved assessment, original criteria adjacent to that assessment, correct local match status, and exact note or explicit absent-note label. Matches move first at £350; excluded venues remain available for comparison. Neither viewport's shell nor iframe horizontally overflowed. Native select keyboard interaction worked and Tab moved from the select to Refresh. An additional mobile-emulation run used direct touch-start/move/end swipes at widths 390 and 320 and reached the final card/provenance; tapping the provenance disclosure worked.

### What actually changed for the user

The retained original £350 view places Willow under “Matching venues” while its card's ordinary “Draft assessment (derived, not supplied)” says “Does not qualify.” Although that sentence itself names £300 and the original view has an explanatory disclosure, the card does not clearly distinguish a saved original-task assessment from a current-filter result. That is a real interpretation problem, not a wrong count or a fabricated assessment.

The new Willow card visibly starts with **“Local result — Matches current filter: Yes”** and current £350/70/step-free criteria. The separate shaded **“Saved assessment (static, original task)”** block repeats the original £300/70/step-free criteria immediately before the unchanged assessment. At £300 the local status correctly becomes No, without changing the shaded text. Labels, placement, and shading make the distinction understandable without opening provenance or remembering a distant explanation. The effect is present in actual screenshots, including the supplied phone screenshot and my desktop/narrow screenshots.

The exact human note remains visible, separate, and unmodified:

> Human: ask Marta about a discount before any booking. Keep this note.

Nothing claims a discount has been obtained or changes the saved £350 quote. The original artifact remains unchanged; my independent original £350 screenshot still shows the old presentation.

## Truthfulness, unknown values, and recovery

- Actual saved facts produce the expected eligibility: Willow's price excludes it at £300 but not £350; River Centre also becomes eligible at £350; Station Loft remains excluded by access; Garden Room by capacity. Travel time is presented for comparison, not silently added as a requirement. No saved assessment is recomputed.
- The actual table has complete required match facts, hence zero unknown match statuses. Its null human notes explicitly show “No human note supplied (unknown),” not an invented note or presumed human approval.
- Separate **browser-only synthetic perturbations of cloned table data** exercised the exact generated JS: null capacity, cost, and access; an omitted required cell; absent travel/assessment/note; false access; malformed currency; malformed table kind; and markup-like saved text. Required missing facts become Unknown, false access becomes No, absent travel does not disqualify a venue, and absent assessment/note remain explicitly absent. Malformed table shape clears cards and produces unavailable/unknown rather than a plausible result. Markup is displayed literally, not executed. These are tests of rendering logic, not newly observed saved facts.
- Refresh preserves the chosen temporary budget and rereads through the declared read action. Reload and navigation away/back reset to £300. This supports the temporary-filter claim; it does not imply durable preference storage.
- A browser-only simulated 409 read failure after success removed the cards and showed “No fresh data loaded and no substitute data used” plus an Unknown count. Retrying against the real read restored the £350 results. A separate initial simulated 403 refusal also showed no fabricated results.
- The real readable fallback remained accessible, explained both criterion sets and the static/current distinction, and did not claim to contain freshly loaded matches. Its bound-table link worked; the destination's visible Willow note field contained the exact note. I did not edit or save that working copy.

`criteria-ux-review/synthetic-evidence.json` records ten passing cases, including the initial-refusal/fallback recovery case. Injected failures are explicitly client-side simulations: they do **not** certify backend stale-revision or revoked-authority enforcement.

## Generated-code and sandbox review

No blocking security or truthfulness defect found in the reviewed generated source:

- Saved data enters text nodes via `textContent`; no saved cell is interpolated into HTML, script, event-handler attributes, or URLs. Row mapping uses a null-prototype object. Duplicate/unknown field identities, duplicate row IDs, malformed cell containers and malformed notes are rejected.
- Only `workagent.request('refresh_venues', {})` is used. The saved action is `read_binding`; there is no generated save, proposal, acceptance, booking, network, storage, or provider operation. Results come from the returned table, not embedded venue fixtures. Recorded original criteria are intentionally constant for this draft, not a task-specific production renderer.
- Money parsing accepts canonical two-decimal strings and computes safe integer minor units; invalid values become unknown rather than being coerced into eligibility. Matching requires integer capacity and boolean access. This is suitable for the exact bound schema, not a universal currency/schema adapter.
- The generated JS validates the binding name and table shape but does not independently cryptographically authenticate response identity. Exact authorized revision enforcement belongs to the trusted host/backend, not to generated code. The host's outgoing request was observed carrying the saved view revision/hash/access generation and an empty payload; no claim is made that generated code alone provides authorization.
- The actual iframe uses `sandbox="allow-scripts"`, no same-origin permission, no-referrer, restrictive feature permissions and a no-network CSP. Live probes could not access parent DOM, cookies, or local storage; fetch was refused; an undeclared bridge action was refused. Saved text containing executable-looking markup did not create executable elements in the isolated generated-code probe.
- Live review traffic's non-GET requests were exclusively `refresh_venues` view-actions; no unexpected mutation/provider request or page error was recorded. The shell's “can't reach your account or the internet” means no direct ambient access: the explicitly authorized host-mediated table read still exists. This limited meaning should not be generalized to “the view cannot communicate with its host.”

These checks are not a comprehensive adversarial sandbox audit or proof of all backend permissions. They are sufficient to find no generated-code blocker in this exact draft.

## Remaining non-blocking UX cost and precise limits

1. **High reading/scrolling cost remains.** Original/current criteria are repeated in the intro, filters and each card. In measured closed-provenance layouts the first card starts 1,126 CSS pixels into the desktop iframe, 1,572 on the 390 viewport, and 1,982 on the 320 viewport. Matching results therefore require substantial scrolling; the human note sits below a long assessment. The repetition earns clarity but not compactness.
2. **Phone content exceeds the host's iframe height cap.** Content measured 5,793 CSS pixels at 390 and 6,804 at 320, versus an approximately 4,000-pixel frame. This introduces nested scrolling. Direct touch swipes reached the end and the disclosure, so it is not lost content, but it remains a navigation cost. No redesign is proposed in this scope.
3. **This is a constrained comparison, not the old general explorer.** Only £300/£350 are selectable; capacity 70 and required step-free access are fixed. That fits the requested proof and avoids accidental task changes, but arbitrary-budget/capacity/access exploration is not retained. Matching-first order is not an explicit ranking or recommendation.
4. The fallback is honest but a dense paragraph and requires the separate table for actual facts. Generic refusal wording does not identify the precise permission/staleness cause. Both are non-blocking for this draft.
5. Browser verification used Chromium, including mobile/touch emulation, not physical iOS/Android devices or a screen-reader audit. Reload/reopen were exercised, not backend process restart. Readable fallback was exercised directly and under failed reads, not with JavaScript disabled across the entire application.
6. The new draft is an independently reviewed sample over an exact replay. It does not retroactively repair the retained original or establish that policy guidance guarantees future generated layouts. Supplied venue facts remain fictional/unverified. No acceptance or issue closure follows from this PASS.

## Evidence and execution notes

Within `.local/criteria-ux-review/`:

- `review.mjs`, `live-evidence.json`: real production UI, six viewport/budget cases, original comparison, keyboard/sandbox/failure recovery, saved-revision readbacks.
- `synthetic.mjs`, `synthetic-evidence.json`: controlled missing/invalid/markup data and initial-read refusal/fallback checks; explicitly not persisted.
- `touch.mjs`, `touch-evidence.json`: successful direct emulated touch swipes at 390/320 and provenance access.
- `*-300-willow.png`, `*-350-willow.png`, `*-top.png`, `*-fallback.png`, `original-phone-350-willow.png`, `touch-*-before-provenance.png`, `touch-*-provenance.png`: visual evidence. Top screenshots are frame-focused scroll positions, not necessarily fresh page-top positions.

Test-development issues were resolved without product changes: the first fallback-link assertion selected a hidden read-only duplicate instead of the visible note input; the locator was corrected and rerun. Chromium's synthesized-scroll helper did not move the frame, so it was replaced by direct touch events; real movement and end-of-content access were then observed and asserted. All final scripts exited successfully. The pre-existing untracked `scripts/verify_criteria_view.mjs` was not edited by this review.
