# Private intake next-action — scoped acceptance passed

**The commissioned synthetic-data live intake slice is verified.** Implementation and evidence remain on the non-default `hermes/intake-next-action` branch (PR #5). No default-branch merge, deployment or external task execution is included.

## Exact artifacts

- Final integrated application/evidence head tested: **`ae52a615b351ab76fc5d0250b62903b0f6845206`** (Claude PR #8, fast-forward integration).
- Frontend implementation: `af41463`; test-only follow-up `f583ecb`; Claude evidence child `ae52a61`.
- Backend independently reviewed at **`c946d0e9dc52933e81fe7287d054d09432d441ea`**; `backend/`, `contracts/` and `agent/` are byte-identical at final application head. Its bounded review evidence is reused, not silently rerun or enlarged.
- Initial generation occurred at `ea0e7ba`; recovery and revision generation at `c946d0e`. Final frontend verification used those same durable live records—no new inference or replacement fixtures.
- This report, final verification JSON and native browser captures are a documentation-only child. The enclosing child commit is not claimed to be the application head tested above.

## Working responsibility

Verified through the real product worker and existing domain/broker/recovery path:

1. Scoped reads of explicitly selected synthetic sources SG-F2, SG-F3 and SG-F7; reviewed skill instructions bound into the run.
2. A useful private next-action document, with a correct stable-ID baseline of **4/8 (50%)**, source qualifications, missing information and a concrete approval judgment. No unsupported time-savings/causal claim.
3. A human constraint saved through the real UI, then one requested model revision. Original human blocks were preserved byte-for-byte; current advice is first and prior advice is explicitly superseded.
4. Inspectable proposal changes bound to the exact reviewed base/body. The UI displays the proposed experiment question as distinct from document-revision approval.
5. Synthetic acceptance-test approval through the domain authority, with the saved body hash equal to the reviewed proposal hash: `899680a8c528e375b8e3a9b76c66d2af4e1909bd8250a156140006cb98c027dc`.
6. Same-response recovery after the observed final-reasoning parser mismatch, without regeneration, evidence overwrite, imported artifact or budget reset. Fresh-worker replay preserved one artifact, two runs and three saved revisions, with zero HTTP attempts or duplicate committed work.
7. Home, Space, assignment and document agree on the approved document. Prepared/approved work is not represented as the underlying experiment having been performed.

The synthetic UI test is not Andrew's approval of a real-world experiment. No message, calendar write, customer action or experiment was performed.

## Frontend holds resolved

Parent independently reviewed Claude's bounded code/test diff, then exercised the production build against the original live Sol records:

- Assignment recommendation equals the **current saved** managed next-action section, not the previous fallback or the superseded historical group.
- All **three** actual source-basis lines, **five** missing-information lines and the specific judgment match the approved document. Two managed groups exist in the saved body, proving the current-vs-history distinction on actual worker output.
- Proposed-but-unaccepted advice is not the adapter's source; it reads `accepted_revision`, with exact acceptance semantics unchanged. Unit and Claude synthetic journey coverage exercise that boundary; the parent final live-record browser probe reads the already-approved version.
- Global fixture-worker/not-live wording is removed. Item provenance remains **“Live provider run (server-attested)”**, including the mobile Agent tab. Worker authorship is “Workagent”, not a fabricated fixture-origin assertion.
- Desktop **1440px**, mobile **390px**, narrow **320px** document/assignment checks pass. Home/Space were rechecked at desktop/mobile. No document horizontal overflow or browser page errors were observed.

[Final machine-readable verification](evidence/intake-final-ae52a61/verification.json) includes checksums for **11 native, unmodified-style browser captures**. The separate automated probe reused Claude's read-only browser harness against the actual Sol records; that harness changes sticky positioning for its own screenshots, so its screenshots are not the native captures published here.

Selected evidence:

- [Desktop actual recommendation](evidence/intake-final-ae52a61/assignment-1440.png)
- [Mobile actual recommendation](evidence/intake-final-ae52a61/assignment-390.png)
- [Narrow approved document](evidence/intake-final-ae52a61/document-320.png)
- [Narrow live provenance](evidence/intake-final-ae52a61/provenance-320.png)
- [Mobile Home](evidence/intake-final-ae52a61/home-390.png)
- [Mobile Space](evidence/intake-final-ae52a61/space-390.png)

## Gates and their limits

- Backend independent review: **248 passing tests** (230 maintained + 18 adversarial), no failures/errors/skips or blocking findings. Includes revocation, receipt-only retention, anti-relabel provenance, unknown-send preservation, exact same-ID correction, owner-only successor approval and cumulative caps. These negative/fault tests use disposable PostgreSQL and synthetic transport, not extra live provider calls.
- Parent frontend verification: typecheck, lint, formatting, **37 unit tests**, production build and actual-record responsive browser probe passed.
- Both exact PR #8 head frontend CI runs passed: [37072228282](https://github.com/alindebergASL/Workagent/actions/runs/37072228282) and [37072199708](https://github.com/alindebergASL/Workagent/actions/runs/37072199708). Publication-child CI is recorded separately in the PR checkpoint.
- The initial parent post-delay readback assertion expecting a still-active safety gate failed because the bounded lease had expired. No data/body/counter assertion failed. An explicit expiry-aware check then verified historical readback, failed continuation authority and zero-HTTP replay. The lease was **not renewed** to make a test green.
- A browser assertion initially searched visible Work-tab text for provenance that lives in the mobile Agent tab. The probe was corrected to open that tab and verify the visible label; no application change was needed.

## Grant expiry and spend

Under `intake-live-01`, the live slice consumed **four generation requests** and four token-count submissions; 15 read-request slots and zero cancels are recorded. No generation retry or fallback occurred. Read-slot counts are reservations, not independently reconciled HTTP access logs.

Reported model usage is **5,798 input / 1,814 output tokens**. Conservative calculated cost is **$0.0326350**, not confirmed provider billing. The retained worst-case reservation is **$0.52768**; root monetary ceiling $20. Unknown-usage steps: zero. Final frontend review added **zero provider calls**.

During the active-grant acceptance, both outcome and safety gates passed. By final frontend review the local continuation lease had expired. The approved document still reads back exactly and its historical outcome remains `readback_verified`/passed; current continuation safety is deliberately failed with **`grant_expired`**, `continuation_available=false`. Replaying completed runs remains idempotent with zero HTTP. **Do not confuse historical completion with renewed execution authority.** Both the four-call plan and local lease are now closed for further generation.

## Boundary and retained evidence

Actual route: `gpt-6.1-sol`, medium reasoning, Responses API with the approved bounded contingency—not an assertion that the OpenAI Agents API supplied hard budget controls. Workspace inputs were synthetic; this is not customer-data or general personal-assistant readiness.

Private original receipts, grant bindings, malformed observation, successor approval, durable state and counters remain preserved. No credentials, connection files, encrypted reasoning or raw provider responses are published. The prior [core checkpoint](INTAKE_LIVE_CHECKPOINT.md) remains historical evidence of the live journey and its then-open frontend holds.

No acceptance blocker remains for this bounded slice. Broader communication/calendar/task integrations, default-branch merge, deployment and any further provider execution remain outside this completion report and require their own authority.
