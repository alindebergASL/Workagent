# B3.4a final narrow residual review — R2/R3 only

2026-10-29, approximately 09:59–10:01 UTC. Same independent reviewer session
`01a186d2-fc6a-7c41-9595-4f4a35a8e67b`; no additional agents or review layers.
Only R2/R3 residual changes, focused tests and supplied browser evidence were
examined. No implementation edits, private environments/credentials, database,
services, network or provider access. Only this report was intentionally written.

**Both identified residual defects are closed. Whole product/paired-client
acceptance is not declared.** The unexercised late-response cases and final
publication/privacy/source-binding work remain explicitly pending below.

| Residual | Decision | Basis |
|---|---|---|
| R2: Retry survives proposal-form cleanup | Closed | Semantic cleanup cancels the current evidence slot; focused pure test and inspected mounted-browser success/denial evidence agree. |
| R3: resource-denied mutation leaves inspected payload visible | Closed | Typed denial reaches the controller's clearing path and screen purge, while preserving the exact unknown envelope. Focused pure/offscreen and transport tests pass. |

## R2 closure

`web/src/components/MemoryPanel.tsx:348`–`:354` now returns
`fence.cancel(EVIDENCE_SLOT)` from the proposal effect. Closing the proposal therefore
cancels whichever evidence request is current, including a Retry replacing the
initial request. It no longer relies on the initial ticket's individual cleanup.
The existing fence drops both success and failure for a canceled ticket. The new
test in `web/test/memory-reads.test.ts` exercises current-slot cancellation.

The adjacent list-refresh repair checks `viewRef` before starting a captured
refresh and again on both completion paths (`MemoryPanel.tsx:252`–`:295`). Together
with existing scope/sequence checks, an obsolete view's refresh cannot fence or
replace the newly selected list. These changes do not automatically rebase CAS or
send mutations.

Inspected `browser-fences.mjs` and
`journey-v2/evidence/browser-fences/results.json`. The script drives a mounted
MemoryPanel, obtains real API read responses, and uses a fetch shim to allow
controlled completion after cancellation. The result records six passing cases:

- Retry closed before late success.
- Retry closed before late denial.
- Evidence completion after an independent list denial.
- History completion after chooser cancellation.
- History cancellation/replacement: the older response is released while the new
  chooser is loading, then the current response supplies a selectable target.
- History completion after an independent list denial.

All six records assert zero POST writes. The mounted retry cases check that the
evidence picker stays absent and existing memory items remain visible; the denied
access cases check that old evidence/history and memory items do not return.
This provides the previously missing mounted-effect evidence for those specific
orderings. **I inspected the parent's execution evidence; I did not run a browser
or access its service.** The 503/404 responses are explicitly injected client faults,
not actual database revocation or proof of server authorization enforcement.

## R3 closure

`backend/workagent/operator_journal.py:31` defines `AccessDenied` separately from
transient read errors and definitive command rejections. `operator_client.py:92`–`:95`
maps HTTP 401/403/404 to that type. This classification works even when the principal
identity itself has not changed, which was the remaining failure case.

`backend/workagent/tui/memory.py:101`–`:106` catches that denial, sets access-lost,
clears selected content and receipt, and leaves the already-prepared command in
`outcome_unknown` with its original body/IDs intact. The screen's existing catch at
`memory_screen.py:177`–`:180` consequently invokes `clear_payload`, which clears
content/details/usage, evidence/history selectors, derived fields and summary.
The authority latch blocks another send. A denied request does not become evidence
that an earlier unknown effect was absent, and no replacement command is created.

Executed the actual offscreen resource-denied mutation test and three HTTP transport
typing cases. The screen test checks exact body preservation, unknown state, cleared
selection/content/details, and blocked subsequent send; transport cases check
401/403/404 using a fake opener. **4 passed, 17 deselected**. This resource-denied
mutation test is an offscreen test with a transport double, not a live server revoke.
The supplied `native-residual.log` separately records **21 passed** for the broader
delayed-read/denial file; that is parent execution, not an additional reviewer run.

## Executed checks and retained limits

- `PYTHONPATH=backend backend/.venv/bin/python -m pytest -q -p no:cacheprovider backend/tests/test_tui_memory_delayed.py -k 'resource_denied_write or http_transport_types_denial'`
  — **4 passed, 17 deselected**, 2.96 seconds.
- From `web`: `./node_modules/.bin/vitest run --configLoader runner --cache=false test/memory-reads.test.ts`
  — **16 passed**, 2.11 seconds. These remain helper/static-rendering tests;
  mounted evidence is the separately inspected parent browser run above.
- Read the narrow implementation changes, browser harness/result, and native test
  source/log. No new broad review, database test run, build or service operation.

**Still unexercised:** same-scope Forget followed by a late response, and client-route
replacement followed by a late response. Do not mark either acceptance case done
from these six scenarios, helper tests, or the source-level fences. This report also
does not establish an older history response arriving *after* a newer choice was
already selected; the inspected replacement scenario releases the older one first.

The parent reports actual paired-client proposal/adoption/later exact usage/rollback
records now exist under `native/` and `browser/`. Those broader journeys were not
re-reviewed in this R2/R3-only pass. Final publication/privacy/source binding remains
pending. Closing these two defects does not erase those obligations or imply full
product acceptance, live learning benefit, or actual authorization-revocation proof.

Prior reports preserved:

```text
69d9dddd9e338f16f68cd8e054bff9ab4c8fea4b09fa97dc13a380dd840a35c4  REVIEW_INITIAL.md
fb17a79241d229a40b2a702552a05f1dbdd1ee485d59c99e37d752f876e6264d  REVIEW_CLOSURE.md
```

Reviewed snapshot:

```text
fc376e871352b3b2d7b49a18c4f91f51c2853db073baeeb94acce3ed8e24328c  web/src/components/MemoryPanel.tsx
9e4175d789d0367aa4ab9311fee83213feaae130a8def6da3af9cd0d56b4f651  backend/workagent/operator_client.py
f853b3e436313b34c78b7ffc575b23172b1aad267becf02ad458b85027a824a5  backend/workagent/tui/memory.py
e218b969796f7195192b1d17fa34e23ae2f13a73da7fb00d4ca92ddd8796aaa5  journey-v2/evidence/browser-fences/results.json
```
