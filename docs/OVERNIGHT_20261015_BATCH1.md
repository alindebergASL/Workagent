# Overnight batch 1: bounded current-work retrieval and visible work

## Authority and ownership

Isolated nondefault branch `hermes/overnight-intelligent-work`, base `92e76d8`.
Hermes integrates/backend; Claude Cloud remains sole `web/` author. Owner commits
through `bb82644` are integrated. No default merge, deployment, credential change,
account access, historical-grant reuse, or new product inference. Original live
review checkout, build and DB remain untouched. New candidate QA uses disposable
PostgreSQL and loopback 3152/8152 only, with no continuous worker.

## Implemented outcome

A human's ordinary untargeted follow-up can discover and read current editable
work that was omitted by the default 8192-byte projection-body cap, rather than
ask the human to supply an internal ID or invent the missing body. The normal
projection limits are unchanged. `saved_work` is an index derived from the same
frozen, scoped canonical read set, not a new work store. It carries exact revision
and body hash, title/kind, size, author kind and explicit omissions. Files and
unlisted historical revisions are not editable targets.

The model may choose `read_saved_work`. The existing worker/broker checks current
membership, grant, lease, snapshot and revision. A run retains at most 32768 body
bytes through this capability; a larger read returns `size_limit` with no partial
body and grants no edit admission. Publication of previously omitted work requires
a complete earlier retained read in the same attempt. Explicit human targeting
cannot switch silently. Edits remain pending proposals against the exact base;
human acceptance is unchanged. Read/restart/replay reuse the existing journal.

The independent review found two genuine gaps and they were fixed: workers could
omit a protected note while a trusted proposal reason claimed retention; and a
restricted SQL writer could forge receipt identity by recomputing the verification
hash. Worker draft calculation AND publication now reject any deletion, change,
renaming or unprotecting of existing protected-note blocks. Human editing remains
authoritative. SQL026 independently binds saved reads to the immutable selected
receipt; SQL025 checks canonical scope/body/bounds. SQL001–024 are byte unchanged.
The false blanket preservation assurance was removed.

No new public HTTP DTO or generated frontend contract was required. Provider
schema/policy/consumer hashes change and historical grants fail closed; they were
not repinned. The new capability is not benchmark-prompt-specific.

Owner changes make work visible in answers, fold routine machinery under Details,
repair cross-workspace deep links and allow a human to add/remove document parts,
including their own note. Parent exercised a real save/readback/reload of that
note. These are useful presentation/continuity improvements, NOT proof of a broadly
intelligent UI or comparable general agency.

## Evidence and exact scopes

Private retained evidence root:
`/home/ubuntu/workagent-overnight-20261015/.local/overnight-batch1/`.

- `retrieval-red-checked.txt`: before implementation, ordinary follow-up lacks
  `saved_work`. Earlier diagnostic failures are retained too.
- `retrieval-third.txt`: 26 new controlled PostgreSQL tests pass at `ce7c4d7`.
- `backend-focused-complete.txt/.xml`: 156 focused existing backend tests pass.
  The earlier foreground attempt timed out after partial progress; not a PASS.
- `independent-backend-review.md`: independent Astra review of exact `ce7c4d7`;
  26 retrieval and 9 alpha guard tests rerun, two findings reproduced. Supplementary
  characterization probes are defect evidence, not passing security acceptance.
- `reviewer-regressions-red.txt`: parent reproduced both findings as failing tests.
- `retrieval-fixed.txt/.xml`: 79 retrieval/alpha/flexible tests pass after fixes at
  `f0a53e4` source. This includes adversarial omission/receipt tests and recovery.
- `retrieval-final.txt/.xml`:39 tests pass at final backend source `5b3e339`,
  including non-document structured-table/custom-view retrieval and the clarified
  policy exception for complete reads of omitted bodies. Controlled only.
- `frontend-v2-unit.txt`: 265 Vitest tests pass; type/lint/format/build pass in an
  isolated build mirror of owner `bb82644`. Initial dependency/fixture-resolution
  setup failures are retained; no web source was changed to make tests pass.
- `browser-routing/`, `browser-routing.txt`: 7 real-service Chromium cases pass,
  including two-workspace deep links, phone and delayed workspace-list link scope.
- `browser-space/`, `browser-space.txt`: 15 real-service Chromium cases pass:
  keyboard/refresh holds, exact target, draft reload, purpose CAS, proposal
  application, mobile, work cards and actual human-note save/readback/reload.
  Provider decisions creating the fixture are scripted synthetic transport.
- `retention-retest/report.json`: parent adaptation of the original independent
  real-component probe; 6/6 pass, including terminal404 and401 body suppression,
  misleading scope regressions, held keys/form and historical baseline control.
  APIs are controlled mocks here, not real service revocation evidence.
- Parent viewed actual desktop conversation,320px Space and human-note screenshots.
  Readable hierarchy/no clipping in those captures; desktop document still has
  conversation+editor columns, and the conversation is a long transcript rather
  than a full adaptive working surface. Direct Browser Use screenshot capture
  timed out; Playwright screenshots succeeded and were actually inspected.
- `card-refresh-report.json`: NEW parent finding, two controlled browser cases.
  Full-conversation explicit Refresh does not reread cards when message count is
  unchanged: zero artifact reads for a changed-title or next-read404 scenario;
  old preview remains. Routed to owner; not a server authorization bypass.

A follow-up independent review could not launch because the one-shot delegation
limit was exhausted (2/2). Fixes were self-reviewed/tested, not falsely called
independently reapproved. Next batch must obtain focused exact-candidate follow-up
review, reusing unchanged review rather than restarting broad review.

## Historical live evaluation remains unchanged

The six admissions on `92e76d8` remain exhausted. The 10215-byte workshop plan
could not be revised by the tested default untargeted path. Human safety note was
never saved in that evaluation. READY meant answered, not verified objective
completion. Calculator prose matched arithmetic; interactive controls were not
exercised. Raw GLM5.3 critique/receipt retained with its mistaken safety-note claim
explicitly adjudicated, not silently rewritten. No current competitor parity or
superiority result exists. Exact primary-source baseline identity/version and
held-out comparative outcomes remain future verification work, not acceptance.

## Budget and continuation

A fresh read-only union of known historical ledgers at 2026-10-15T05:24:17Z matched
$8.97056 reservations. Successor grant remains14 dispatch/14 count/100 read,
$1.84688reserved; its SIX admissions remain consumed. Cumulative authorization
$40, historical encumbrance$24.617200, unactivated$15.382800. New product calls and
spend in this batch:0. Billing/route/current pricing were not newly validated;
reservations are not bills. Both unknown-count attempts remain quarantined.
Full metadata-only readback and summary are retained in `budget-readback.json`
and `budget-summary.json`.

Owner coordination comments, exact body readback verified:
- https://github.com/alindebergASL/Workagent/pull/9#issuecomment-6184636381
- https://github.com/alindebergASL/Workagent/pull/9#issuecomment-6185232681

Next useful slice: finish card-refresh owner fix and focused re-review; establish
an enforced exact-candidate successor inside the unchanged cumulative budget on
new disposable state without repinning exhausted history; run held-out natural
follow-ups and changed requirements across materially different tasks, preserve
all failures, and evaluate correction/memory/resumption rather than merely schema
availability. Broad intelligent UI and autonomy acceptance remain open.
