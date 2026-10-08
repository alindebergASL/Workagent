# Ordinary live reuse checkpoint

Implementation candidate: `8ed405eb3c1af10dcfe7e7303b891cd46265a078` on `hermes/adaptive-product-integration`. Synthetic business inputs only. Official `gpt-6.1-sol`; direct Z.AI `glm-5.3` code review. No merge or deployment.

## Actual outcome

The person entered an ordinary workshop-booking prompt through the browser composer: attendee count and per-attendee price, initially8 and2500 cents. No algorithm, function name, intentional failure or supplied acceptance-check specification was provided. The live model published a reusable `booking_total` tool returning20000.

The person then changed attendees to10, saved a human note, and clicked **Run saved tool**. Actual local Wasmtime execution returned25000 with **zero additional provider dispatches or reservations**. The result was proposed, not silently applied; explicit acceptance retained the note.

A natural follow-up requested a fixed5000-cent room fee. A second live model turn proposed an updated version returning30000. Saved code was unchanged until explicit acceptance, and the human note survived. Actual download bytes matched the accepted code; the filename used its entrypoint. Desktop,390px and320px checks passed, followed by readback after restarting the isolated API/web services. Restart caused no mutation requests.

Independent arithmetic checks passed **100/100 sampled cases** across the original and revised code. This is a sampled numerical-domain check, not a claim of exhaustive business correctness. Both model turns remain `partial`/`needs_validation`; the explicit local run is separately labeled local execution, not a model-generated answer.

## Reuse defect and correction

The ordinary-use preflight exposed a real admission bug: every explicit operation was rejected in a model-scoped conversation, including **Run saved tool**. A regression failed at that guard before the correction.

The new carve-out permits only `RunWasm` against an existing artifact and exact saved base, with `code=None` and no attachments, model target or supplied acceptance specification. It remains behind the single active scoped grant, consumer pin, source, and unresolved-provider checks. Existing conversation/artifact authorization, compare-and-swap and execution fences still apply. New code and new tool creation through this path are denied. Ordinary inference still consumes the original grant and remains denied once its allowance is exhausted.

This explicit request uses the existing local worker and proposal path; it neither falls back from failed inference nor claims model provenance. Operator verification invoked the appropriate existing model/local worker after each admitted turn; this is not a claim that a public deployment or unattended mixed-worker service was configured.

Direct `glm-5.3` review: **PASS, no findings**. Nonblocking notes: unresolved provider states intentionally continue blocking this conservative local path; the reviewer speculated about an empty acceptance list, but the API's typed acceptance object does not accept a list. No gate was weakened to address that speculative case.

## Budget and recovery truth

Two natural model turns used four provider dispatches in total. One explicit local run used none. Cumulative project reservations are **$2.638400 of$20**, including historical carried liabilities and earlier failed attempts; provider billing remains unknown.

The same live database and shared ledger were retained. The prior checkpoint's completed, run-exhausted grant was revoked before installing this separate bounded two-turn grant because the existing database permits only one active grant per principal/workspace. Original grant bytes, receipts and costs were not rewritten or refunded. Protected historical source databases remain read-only.

Initial browser setup hit that active-grant constraint before any prompt/model dispatch; the already-created empty conversation was reused after correcting setup. A later harness assertion expected a null field where the API omitted it, and another selected a hidden detail value instead of the visible Result card. Those failures are retained. Recovery only re-read the completed first turn; it did not regenerate it. The successful local/follow-up/restart reports are distinct artifacts, not overwritten failure logs.

## Evidence

- **71 focused backend tests** and **613 full backend tests passed** on fresh `workagent_test_2f76cdec9737`, with zero failures/errors/skips and one dependency deprecation warning.
- **112 web tests**, typecheck/lint/format, production build and canonical contract check passed.
- Review file hashes matched the candidate; runtime bytes stayed frozen throughout full regression and live verification.
- Private `.local/ordinary-live-03/`: authority/readbacks, original failed harness reports, successful first readback/local/follow-up/restart reports, immutable response identity records, screenshots/traces, exact downloaded WAT and case-by-case independent evaluation.
- Private `.local/saved-tool-run-review.json`, `.local/ordinary-preflight.xml`, `.local/ordinary-full.xml` retain review/test receipts. None contain production customer inputs.
- The original3000/8000 demo is untouched. The isolated preview stays on3120/8120; it is not a public deployment and new model turns are not standing-authorized.
