# General-purpose proposal review batch — installed, qualified evaluation

## Verdict

The shared review-safety and layout changes are installed privately at
`d4d019c4b9bebca9ca8b49d1466a92fab7514aff`, not merely built or published.
Fresh planning and editorial exercises completed through explicit browser acceptance
and exact read-back verification. Safety/layout/acceptance checks PASS; overall
product quality remains PARTIAL. Planning needed one explicit preservation-repair
prompt; note editing needed a formatting workaround; latency did not improve.
These are observed defects, not reasons to relabel the whole product complete.

## Delivered scope and engineering verification

- Server-side review requirements for an older same-base candidate and removal or
  replacement of saved content. Acknowledgements default false; no automatic retry
  with consent invented by the client. Applies across supported artifact kinds.
- One latest candidate, retained earlier history, selected-candidate comparison,
  removal warnings and explicit acknowledgement. Desktop full-table review contained.
- Domain-neutral concise-output guidance and investigation of generation latency.
  No planner-specific runtime or fixture-specific handler was added.
- 94 focused backend tests; 69 frontend tests; TypeScript and ESLint checks;
  independent follow-up review PASS; production build `MR5C72Qao_Js_3PAIcmNa`.
  A broader run was deliberately interrupted after 79 passes: not a full-suite pass.
- Review findings were reproduced and repaired: decimal replacement misclassified
  as additive prose, metadata-named user columns skipped, earlier review selecting
  latest comparison. Reviewed-source hashes checked at commit/install.
- Installed candidate `/home/ubuntu/workagent-candidates/general-review-20261023`.
  No default-branch merge or production deployment. Existing data and history retained.

## Live evaluation, not replay

All inputs were synthetic. The evaluator used the browser and normal product
commands; database observation used read-only REPEATABLE READ transactions.
No browsing, contact, booking, publishing or external account effects were requested.
The browser was closed to `about:blank` during the unattended check-ins; there was
no source resupply, direct database write, operator-created result, or manual wake.

### Planning: day → human changes → week → unattended review → repair → acceptance

Conversation `0409e640-8b4b-4f7c-925f-008d70abb774`;
artifact `8aa13a17-618d-4f43-b92c-55b3ac098d22`.

1. Uploaded calendar/tasks, requested editable day plan, then saved T1 completion
   and a human preservation/no-overtime note through the UI.
2. Uploaded a later availability/dependency amendment and requested the week's
   outlook plus one check-in. New Monday appointment and unavailable Wednesday
   afternoon were respected; Tuesday's T4 meeting was not allocated twice.
3. Parent parser verified allocations, no lunch/meeting/task overlap, deadlines,
   effort and T5-before-T6 dependency. Only T1 was marked done. Optional backlog:
   120 minutes tentative, 780 deferred. T7 correctly remains blocked: expected,
   unconfirmed Friday 11:30 figures leave 30 minutes for 90 minutes due by noon.
4. Unattended run `04b29e1d-85e1-40ee-afa7-e0b3daf3932d` reread all three complete
   source files and the complete pending proposal. It did not generate a duplicate
   proposal or invent progress, and stopped `waiting_person` with no next check-in.
5. First proposal `9f07177d-0a73-4813-800c-4f28f3e548b1` omitted the final saved
   Original tasks.txt context note. The agent's check-in identified this. The
   evaluator did NOT accept it; requested exact preservation without resupplying
   sources. Corrected proposal `a9f665ce-09bf-4fd4-a297-a3e0d877af43` preserved every
   saved note verbatim and every original-input/row-note cell. The earlier proposal
   remains unchanged in history; this was not a first-pass quality success.
6. Explicit evaluator acknowledgement and acceptance created human revision
   `b78c59b9-906a-4f07-8853-3483c9e1cb0d`. Saved body exactly equals the reviewed
   latest proposal; only one new revision; prior revisions/proposals retained.
   T7's real decision remains unresolved: accepting the plan does not complete tasks.

### Editorial: brief → human edit → amendment → unattended review → acceptance

Conversation `7e6b4619-2a6d-4941-bc74-34746a567740`;
artifact `67d14cda-bb7a-428e-98bd-0136e2735562`.

The Willow Archive invitation changed from Great Hall/16:00–18:00/30 visitors to
Reading Room/17:00–19:00/24. Admission remained explicitly undecided; no invented
price or booking link. The approved accessibility sentence, visitor rules and full
human review note were preserved. Historical free-entry wording remained labeled
as historical, not current approval.

Unattended run `5e878f9a-3e04-46b7-ab7a-a36a87f7249a` reread both complete sources
and the pending proposal; created no duplicate proposal; stopped waiting for the
person with no recurrence. The evaluator acknowledged the replaced event details
and accepted `683d874f-0eda-4139-87de-3a644e478058`. Exact read-back confirmed human
revision `1e581361-7d21-435e-a2b8-bdbfe9bb3a9d`, matching the reviewed body; all old
versions retained. Acceptance is not publication or an admission-price decision.

## Browser and state verification

- Installed old three-candidate fixture: latest separated, earlier history retained;
  selecting an earlier draft displayed that draft's comparison, including its
  known malformed historical note after expanding notes. No old fixture accepted.
- Both fresh proposals: apply disabled without acknowledgement, enabled after the
  evaluator's deliberate acknowledgement. No unattended acceptance occurred.
- Expanded full proposed tables/documents and notes: desktop viewport 1440,
  document width 1425; phone viewport/document width 390. No page-width overflow.
  These are DOM/layout measurements with screenshots, not a claim of complete
  accessibility or visual-design review.
- Both accepted assignments remain `waiting_person`, no schedule. Their last
  outcome text still describes the earlier unaccepted state while dependency
  observation flags the changed saved version and outcome becomes `needs_review`.
  Next-batch visibility must distinguish historical observations from current facts.
- Initial amendment runs report `partial` because work/decisions remain, while
  unattended checks report `ready`; these are not equivalent to completed goals.
  A test wait loop initially expected all runs `ready` and timed out. This was an
  evaluator predicate error; raw states and subsequent verification are retained.

## Measured latency: no speed claim

Journal span, seconds (includes network/provider and observation delay, not direct
provider-only latency):

| Work | Span | Summed dispatch-to-result | Artifact generations |
|---|---:|---:|---:|
| Initial day plan | 95.60 | 89.328 | 1 |
| Initial invitation | 47.22 | 42.015 | 1 |
| Weekly amendment + responsibility | 505.73 | 456.364 | 1 |
| Editorial amendment + responsibility | 224.80 | 194.990 | 1 |
| Planning unattended review | 120.13 | 101.575 | 0 |
| Editorial unattended review | 248.65 | 230.831 | 0 |
| Planning preservation repair | 222.20 | 177.008 | 1 |

Each amendment produced one draft, and neither check-in generated another. This
improves the demonstrated duplicate-draft behavior, but the weekly amendment is
slower than the prior 296.80-second journal baseline despite fewer full-artifact
passes. Different prompts/model variability preclude causal benchmark claims.
Further latency work must examine decision/tool/finalization phases and report
p50/p95 on varied tasks, not attribute delays to polling without evidence.

## Remaining gaps feeding the next two batches

1. Generated multiline table notes can exceed the line-oriented editor's ten-note
   limit when edited. Five note objects rendered as seventeen lines. Evaluator
   explicitly normalized internal line breaks to spaces, preserving text, then
   added the human note. This workaround is not an editing PASS.
2. Prompt guidance does not guarantee all saved notes survive proposals. Review
   gates prevent silent acceptance, not proposal-quality mistakes. Preserve and
   inspect all candidates, not only the corrected latest one.
3. Operator CLI/TUI acknowledgement parity is not in this implementation. The old
   accept command fails closed when review is needed; batch 2 starts with parity.
4. Current/historical outcome reconciliation and truthful resumed-work visibility
   need work; a queued command, admitted execution and verified outcome differ.
5. Responsiveness remains weak. Fewer duplicate artifacts is not lower latency.

## Budget, evidence, ownership

Same cumulative $100 product-evaluation ceiling. Grant 15 aggregate allocation:
$92.10596. Reservations increased by $7.24220 to $66.58608. Provider billing remains
unknown; three historical unknown-usage steps remain. Five generation slots remain
on this grant; no further paid generation is part of this completed evaluation.
No liability/history reset or new budget authorization was implied.

Product model: `gpt-6.1-sol`; backend/integration/review: GPT-6 Astra; Claude Opus owned
web implementation. Parent performed DB tests, install and live acceptance checks.

Machine evidence: `docs/evidence/general-review-batch/`. Full frozen/local evidence:
`/home/ubuntu/workagent-general-review-evidence/`, including RED regressions,
reviewed manifest, build/review/test logs, seven run journals, browser captures,
source fixtures, observations, and `verify_live.py` / `verify_acceptance.py`.

This batch is delivered privately with qualified results. The wider product mission
is not complete. The next requested deliverable is researched implementation plans
for (2) conversational TUI/attachments/ongoing-work visibility and resumption, and
(3) broad tools/connectors/cross-assignment memory, evaluated across varied tasks.
Those plans are not permission to enable new private-account access or effects.
