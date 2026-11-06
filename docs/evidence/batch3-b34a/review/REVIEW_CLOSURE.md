# B3.4a narrow closure review — R1–R5/C1

2026-10-29, 09:12–09:20 UTC approximately. Continuation of the same independent
reviewer session `01a186d2-fc6a-7c41-9595-4f4a35a8e67b`. No additional agents.
Read-only implementation review and pure tests; no private environments,
credentials, services, providers, network or databases accessed. Only this report
was intentionally written. `REVIEW_INITIAL.md` is preserved, SHA256
`69d9dddd9e338f16f68cd8e054bff9ab4c8fea4b09fa97dc13a380dd840a35c4`.

**R1, R4, R5 and C1 are closed at the substantive implementation level. R2 and R3
are partially repaired but remain open for the specific residual cases below.**
Actual paired-client/transfer acceptance remains separate and pending. The web
deferred tests do not mount MemoryPanel; no mounted-browser closure is inferred.

| Initial item | Closure decision | Exact remaining issue |
|---|---|---|
| R1 conflict ordering | Closed | No remaining defect established in this narrow scope. |
| R2 web late responses | Partially closed / open | Original pre-denial response leak is fenced in source; retry read survives proposal-form cleanup (P2). Mounted effects still need parent browser evidence. |
| R3 native completion authority | Partially closed / open | Identity/token/endpoint completion fences work; a resource-denied mutation still leaves inspected payload visible (P1). |
| R4 rollback projection | Closed | Canonical eligible IDs now bridge projected superseded history and both clients. Actual client journeys remain acceptance work. |
| R5 nested failures | Closed | Bounded operational outcome is exposed independently of outer receipt/digest and displayed by both clients. |
| C1 confidence semantics | Closed | Procedure adoption/correction/rollback retain inferred confidence; explicit preferences remain distinct. |

## R1 — closed

`backend/workagent/memory/retrieval.py:28`–`:36`, `:81`–`:102` separates relevance
from adoption. Authorized relevant contested siblings now participate in conflict
grouping before the final autonomous eligibility filter. Unreviewed candidates
remain excluded from instructions and do not themselves create an active conflict.

Re-executed the original pure reproduction against the real retrieval method,
with authorization stubbed and two validated same-key procedures: active versus
contested, both relevant to `data join`. It now recalls **zero** procedures.
The inspected PG regression source additionally covers disputed candidates,
disputed adopted siblings, and unrelated/unreviewed siblings. Its corrected parent
log is discussed below; I did not execute its database fixtures.

## R2 — original authorization fence repaired; proposal retry cancellation open

The new `web/src/lib/client/memory-reads.ts` checks epoch, newest slot ticket,
abort state, and single delivery on both success and failure. MemoryPanel revokes
the fence on access loss, replaces it per scope key, cancels restore slots on
cancel/forget, and hides the evidence proposal while access is lost. These address
the original source-level pre-denial evidence/history completion problem.

**Residual P2, reproduced with pure code:**
`web/src/components/MemoryPanel.tsx:331`–`:334` captures only the cleanup returned
by the effect's initial evidence request. The Retry handler at `:673` starts a new
read and discards its cleanup. The helper's cleanup at
`web/src/lib/client/memory-reads.ts:96`–`:98` deliberately cancels only its own
ticket. Consequently:

1. Initial evidence request fails transiently; the effect retains its old cleanup.
2. Human clicks Retry, starting another evidence request.
3. Human changes Kind away from procedure; effect cleanup runs for the first read.
4. Retry completes after the proposal has closed. Its ticket is still current.

Executed the actual loader/fence code with deferred promises and the panel's
cleanup ownership pattern. A late denial produced:

```text
CLOSED_PROPOSAL_RETRY_CALLBACK { denied: true, loaded: false }
```

Thus a closed form can still apply a stale completion, including clearing the
remaining memory view through `loseAccess`; a success also still reaches its sink.
This is a narrower lifecycle defect than the repaired P1 disclosure path. Required
fix: cancel the current evidence slot at the semantic proposal-form close boundary,
independently of the original request's cleanup. Preserve the helper's protection
against an old request cleanup canceling a legitimate replacement in other cases.

This reproduction is a pure loader/integration-ownership probe, **not a mounted
React test**. The source wiring establishes the cleanup mismatch. Existing deferred
tests cover a canceled initial request, but not initial failure → Retry → form close.

## R3 — completion identity fences repaired; mutation denial clearing open

`backend/workagent/tui/memory.py:28`–`:57` now validates principal, endpoint and
session token before and after reads. `memory_screen.py:116`–`:122` rechecks before
screen consumption. The delayed screen tests exercise evidence, inspect, usage and
refresh with owner/endpoint/token changes and identity denial. These passed in my
pure/offscreen run.

An additional pure mutation probe changed identity while returning a POST receipt.
The controller denied completion, cleared selection, retained the **exact original
body** as `outcome_unknown`, and blocked replay under the changed identity:

```text
UNKNOWN_AFTER_IDENTITY_CHANGE {'access_lost': True, 'selected': None,
 'pending': 'outcome_unknown', 'body_preserved': True, 'posts': 1}
REPLAY_BLOCKED_POST_COUNT 1
```

**Residual P1, reproduced in the actual offscreen MemoryScreen:** resource access
can be revoked while `/identity` continues to identify the same principal. The
operator client's HTTP 404 authorization response becomes `OperatorError`, not one
of its narrowly recognized `DomainRejection` cases. `MemoryController.send`
(`memory.py:91`–`:105`) lets this exception escape without clearing selection or
marking access lost. The screen catch (`memory_screen.py:177`–`:180`) clears only
when `access_lost` is set or the action was a read. A denied `correct` action leaves
the prior inspected payload on screen.

Using a fake transport returning exactly that error form, while identity remained
unchanged, the real screen produced:

```text
DENIED_WRITE {'access_lost': False, 'selected': True,
 'displayed': 'Use concise headings', 'pending': 'outcome_unknown'}
```

Required: distinguish an authority-denied response from transient/ambiguous I/O and
clear displayed/selected evidence and derived forms on that denial. **Keep the
unknown command envelope and original IDs/body**; a denial must not authorize a
new command or silently settle an earlier uncertain effect. No automatic resend.
The existing denial tests deny `identity()` during reads, so they miss this branch.

Unmount inspection: `on_unmount` closes the lane, marks the controller access-lost,
and drops selection/pending RAM state. Normal close is blocked while busy/pending.
I also popped the actual offscreen screen during a delayed read and released it:
controller access-lost remained true, selection was null, and no evidence options
were installed. Textual's `is_mounted` property still read true in that observation;
the controller revocation was the effective fence. Forced teardown discards the
RAM-only pending record; this is not durable reconciliation or proof an unknown
operation did not happen. No cross-session replay was observed or claimed.

## R4 — closed against canonical projected history

`backend/workagent/memory/store.py:221`–`:236` derives `rollback_revision_ids` by
running the rollback eligibility logic against the stored revisions, **before**
projecting their display status to superseded. `procedures.rollback` checks
original active adoption, reviewer, procedure details, temporary exceptions and
union dependencies; it now passes the union source refs into scoped authorization.
The command still applies current CAS and SQL checks when sent.

Web `rollbackTargets` consumes the canonical IDs, not raw active status, and
excludes current/foreign/erased entries. Native `memory_screen.py:256`–`:259` also
uses those IDs. Both focused client tests now use superseded v1 history with a
server-provided eligible ID. The parent regression asserts the actual inspection
projection and IDs, excludes the candidate, exercises stale CAS and restores v1.
No fabricated raw-active history is needed to make these tests pass.

Generated MemoryContract JSON exactly matches the Python model; relevant OpenAPI
schemas match after the normal FastAPI null-default/reference normalization. New
client fields are generated aliases, not an independent DTO definition.

## R5 and C1 — closed

`procedures.py:53`–`:77` retains the outer outcome and exact evidence digest, while
extracting only recognized enum values from the typed result/status envelope into
`operational_outcome`. Arbitrary text and unknown status strings do not become
outcomes. The enum covers the inspected MCP/compute/GitHub/research result statuses.
The server label includes the nested outcome, so native's existing label display
shows it; web displays the dedicated field and marks known non-success outcomes.
The pure parameterized tests verify the observation and digest are unchanged.

Review, correction and rollback now set procedure confidence to inferred, with
disputes uncertain. SQL 067's review/correction/rollback rules agree
(`:209`, `:233`, `:242`). Explicit preferences retain explicit confidence. Web
explains that adoption does not test effectiveness; native shows inferred confidence
and the same distinction from empirical validation. This closes the original
overloaded-label concern without changing historical outcomes or claiming learning
benefit. I did not inspect installed databases; the parent's statement that only
new disposable test-03/test-04 fixtures used changed SQL is not independently
verified by a database read in this review.

## Precisely what the pending browser checks must settle for R2

Use the built app's **mounted MemoryPanel and actual React effects**, with delayed
responses that can still complete after cancellation. Merely observing a fetch
abort does not establish that stale completion handling is correct.

- Start evidence/history reads, trigger an access denial through another real panel
  path, then release old responses. Assert private markers/options and history
  forms remain absent, proposal fields remain hidden, chosen refs are not restored,
  and no command is sent.
- Change conversation/authenticated scope while reads are pending; release old
  completions after the new panel is visible. Assert no old-scope marker, choice or
  draft appears and the current scope's state remains intact.
- Cancel a restore chooser, then release its read. Repeat with a forget receipt
  and with a newer chooser/read replacing the old one. Assert no chooser reopens,
  no forgotten payload returns, and the newest choice/base survives. A selected
  rollback must retain the opened CAS, with no automatic rebase or resend.
- After fixing the residual above, exercise initial evidence failure → Retry →
  change Kind away from procedure. Deliver both late success and late denial in
  separate cases. Neither may update the closed form or clear the current view.
- Confirm canonical eligible v1 appears despite projected superseded status, and
  candidate/contested/temporary revisions absent from server IDs are not offered.

These are the missing mounted integration observations, not a demand for another
reviewer or a broad campaign. Native HTTP/terminal journeys and narrative/data
transfer outputs remain the parent's separate product acceptance obligations.

## Evidence executed versus inspected

Executed by this reviewer:

- `PYTHONPATH=backend backend/.venv/bin/python -m pytest -q -p no:cacheprovider backend/tests/test_tui_memory.py backend/tests/test_tui_procedures.py backend/tests/test_tui_memory_delayed.py backend/tests/test_procedure_memory_unit.py backend/tests/test_procedure_review_regressions.py -k 'not relevant_contested_sibling and not irrelevant_and_unreviewed and not api_projection'`
  — **52 passed, 4 database cases deliberately deselected**, one deprecation warning.
- From `web`: `./node_modules/.bin/vitest run --configLoader runner --cache=false test/memory-procedure.test.ts test/memory-commands.test.ts test/memory-reads.test.ts`
  — **59 passed**, 3 files. Helper/static rendering tests; not mounted browser tests.
- From `web`: `./node_modules/.bin/tsc --noEmit --incremental false` — exit 0.
- Pure probes documented above, canonical schema comparisons, and `git diff --check`
  — completed. The probes exposing residual failures are intentionally recorded as
  findings, not folded into passing test totals.

Inspected parent evidence: `web-lane/web-repair-report.md`, `native-repair.log`
(21 passed), `pg-repair.log` (74 passed / 3 fixture method-name failures),
`review-regressions.log` (later remaining fixture naming failures), and
`review-regressions-final.log` (**14 passed** after those corrections). Failure
history remains intact. These are parent executions, not my PG/HTTP runs; do not
add totals across overlapping runs or infer a whole-suite/product acceptance pass.
No actual paired-client or transfer output acceptance is claimed here.

Reviewed source snapshot hashes for the remaining edges:

```text
0c65b06699de48c2f21231a338438466cb9717048cd5021451f7ea0a9da1bbfe  backend/workagent/tui/memory.py
c6d806c2de6d9bbf5769fde5d7f318132714c4b260df0d07c9c865a2ae3bddfa  backend/workagent/tui/memory_screen.py
73ee9538946f25a7e3d238e80def73d586a0ea4a32af56d6692c28c0eec90ebd  web/src/components/MemoryPanel.tsx
9dd460334ae1506eae9d1253a0a73b44e6815f562bc25f91684f49a94bcf5627  web/src/lib/client/memory-reads.ts
```
