# B3.4a independent focused risk review

Reviewed 2026-10-29, ending approximately 08:51 UTC. Base HEAD:
`16923fef5f82f41c53e8242fe4e69e21de8da377`, plus the current uncommitted integration.
**Changes required; this is not product acceptance.** Review performed independently
by the reviewer, without another agent or consultation with the implementer.

Scope is human-proposed, evidence-backed procedural memory in the existing store.
There is no automatic extraction, paid-model benefit, or autonomous-learning claim
to accept here. Read the authority/product/build/status documents, local contract
and backend handoff, current implementation diff, migration 067, focused tests,
and available PG result logs. No implementation edits, database access, services,
provider/network calls, credentials/private environment reads, commits or publication.
The only intentional repository write by this review is this report.

## Required fixes

### R1 — P1: autonomous filtering removes the dispute before detecting conflict

Locations: `backend/workagent/memory/retrieval.py:22`, `:75`, `:79`–`:95`.

`procedure_matches` rejects contested revisions. `_recall_memory` applies this
filter before constructing conflict groups. With two authorized procedures sharing
the same subject/predicate, one active and one contested, inspection correctly
shows a conflict, but autonomous recall drops the contested sibling and presents
the active instruction as unopposed. Both can have identical matching terms.
This defeats the explicit rule that unresolved conflicting procedures cannot guide
autonomous work; it does not require an unauthorized database write.

**Executed pure reproduction:** called the real `_recall_memory` with two validated
`MemoryRevisionV1` objects and an in-memory cursor, stubbing authorization only.
Same key, different contents, same `data join` retrieval term, statuses active and
contested. Actual output:

```text
CONFLICT False [('a', 'contested', True), ('b', 'contested', True)]
CONFLICT True [('a', 'active', False)]
```

Required: detect conflicts among currently authorized relevant assertions before
dropping contested procedures; preserve the dispute while excluding candidates
from authority. Add the active-versus-contested sibling case, not merely a test
that a single contested item is omitted. This probe tests selection logic, not PG.

### R2 — P1: late web evidence can repopulate payload after access loss

Locations: `web/src/components/MemoryPanel.tsx:229`–`:238`, `:299`–`:320`,
`:327`–`:357`, `:666`–`:688`.

`loseAccess` clears evidence/forms and advances `listSeq`, but neither the evidence
success handler nor the restore inspection handler checks that sequence or an
authorization epoch. They check only workspace/conversation/session key equality.
Concrete ordering: start evidence read A; a later list/inspection returns an access
denial and calls `loseAccess`; A then resolves with the older authorized response.
The key is unchanged, so A restores the human-message labels and evidence options.
The proposal/EvidencePicker is rendered even when `accessLost` is true, alongside
the assertion that nothing is shown. The backend may refuse subsequent writes;
that does not prevent this local disclosure of revoked payload.

Restore reads have the same missing invalidation and can also recreate a canceled
chooser or repopulate forms after a forget receipt. An old request can overwrite a
newer chooser under the same key. Existing CAS protection does not authorize the
response or preserve the latest local form intent.

Required: fence every evidence/history completion with an authorization epoch and
per-read/form identity; invalidate on denial, forget, scope change, cancellation,
and replacement. Gate payload rendering on current authorization. Check abort on
the success path as well. Add deferred-response component tests for these exact
orderings. **Inspected control flow; not browser-executed by this reviewer.** The
43 passing web tests do not exercise these component lifecycle races.

### R3 — P1: native evidence read authorizes only before I/O

Locations: `backend/workagent/tui/memory.py:26`–`:30`, `:115`–`:117`;
`backend/workagent/tui/memory_screen.py:147`–`:152`.

The new evidence method checks endpoint/identity, performs a blocking request,
then returns its payload without checking authorization again. The screen commits
that response after `await` with no session/authorization identity check. Existing
`inspect` has the same pattern at `memory.py:39`–`:43`, which also affects the new
rollback-history controls. Serializing the read lane prevents concurrent commands,
but does not establish that the response still belongs to the current identity.

**Executed pure reproduction:** a fake client returned owner A from `identity`,
changed its principal to B inside `request`, and returned A's evidence payload.
The real `MemoryController.lesson_evidence()` returned:

```text
NATIVE_LATE_RESPONSE {'items': [{'label': 'OLD OWNER PRIVATE EVIDENCE'}]} identity_after other-owner
```

Required: bind the request and completion to the authenticated endpoint/session
identity and invalidate sensitive screen state on mismatch before publishing it.
Add a delayed response/identity change test, covering evidence and history. This
is an executed controller probe, not a claim of an actual terminal/account switch.

### R4 — P2: web rollback rejects the history shape the backend actually returns

Locations: `backend/workagent/memory/store.py:221`–`:224`;
`web/src/lib/memory-contract.ts:524`–`:541`;
`web/test/memory-procedure.test.ts:338`–`:369`.

After adopted v1 is corrected to v2, `inspect_memory` projects v1's status to
`superseded`. `rollbackTargets` requires `status === 'active'` and explicitly
excludes superseded revisions. The normal v2-to-adopted-v1 rollback therefore
has no target in the web UI, although the backend permits it using the immutable
stored v1. The unit fixture supplies raw-storage `active` history and even asserts
that `superseded` is excluded, so it locks in the integration defect.

**Executed pure reproduction:** imported the actual TypeScript helper with Node
type stripping and passed API-shaped v1/v2 history:

```text
WEB_ROLLBACK_API_SHAPED_HISTORY []
WEB_ROLLBACK_RAW_STORAGE_HISTORY ["v1"]
```

Required: preserve/expose authoritative original adoption or rollback eligibility
in the inspection DTO and consume it consistently in both clients. Merely allowing
every `superseded` + `human_reviewed` revision is insufficient: superseded contested
or rejected revisions can have that origin too. Native currently allows superseded
revisions (`memory_screen.py:247`–`:251`) but does not exclude temporary exceptions
or prove original active adoption; those choices fail server-side. Keep the server's
candidate/temporary/foreign/revoked-target checks, regenerate contracts as needed,
and test chooser behavior with actual inspection output.

### R5 — P2: evidence discovery drops known inner tool failure state

Locations: `backend/workagent/memory/procedures.py:53`–`:61`;
`backend/tests/test_procedure_memory_pg.py:283`–`:286`;
`web/src/lib/memory-contract.ts:392`–`:402`.

Discovery derives the displayed outcome only from the outer observation status.
The MCP test explicitly creates `status='observed'` with
`output.result.status='unavailable'`, then asserts discovery says `observed`.
A human choosing evidence sees only the capability and outer status; the known
failure is absent. The UI caveat correctly avoids calling this success, but does
not tell the reviewer that this particular operation was unavailable, and the
failure treatment does not trigger.

**Executed pure reproduction:** the real discovery formatter, with an in-memory
authorized row containing that nested unavailable result, produced:

```text
Tool observation: connectors.mcp.read — observed
```

Required: retain the immutable outer receipt status/digest and additionally expose
a bounded server-derived operational outcome when the adapter reports failure,
unavailability, denial, or uncertainty. Render it in both clients and test nested
failure paths as well as exceptions that become outer `failed`. Do not rewrite
historical receipts or label every outer `observed` result as failed.

## Confidence semantics requiring resolution

**C1 — P2:** `memory/review.py:14`–`:17`, `corrections.py:25`–`:27`,
`procedures.py:85`–`:88`, and SQL 067's corresponding transition checks force
`confidence_label='explicit'` on accepted/corrected/restored procedures. A pure
call to `review.changes` changed an `agent_inferred/inferred` candidate into
`human_reviewed/explicit` solely because the decision was accept. Human approval
is real, but it does not make the proposed relationship explicitly stated by the
user or empirically established. The retained `human_reviewed` origin helps; the
model-facing context still receives the overloaded confidence label without a
clear definition separating epistemic basis from approval.

Resolve whether `explicit` means an explicit preference/statement or simply an
explicit review action. Preserve reviewed inference as such, using separate review
state or an unambiguous label/policy. SQL and clients must agree. This is a semantic
contract issue, not evidence that the current code changes origin to `human_explicit`
or that a paid model has actually misinterpreted the label. No such model was run.

## Inspected protections and limits

- SQL 067 checks exact human event identity/digest/owner and human evidence origin;
  tool references bind attempt/run/digest, current grant, capability installation,
  generation, selectors/reductions, connector and research authority. Source scope
  is task/explicit-project bounded; evidence-backed user scope is denied. Discovery
  authorization is in the SQL predicate before its 50-item limit. These are source
  observations, not a fresh restricted-PG proof performed by this reviewer.
- Candidate creation and direct candidate correction stay non-active; legacy
  procedures without details cannot be adopted. Correction and rollback union
  dependencies, enforce current CAS, and preserve the current narrower scope.
  SQL mutation allowlists and the private rollback implementation prevent obvious
  field-smuggling and direct-function target bypasses in the inspected code. No new
  concrete SQL bypass was established within this focused review.
- Forget erases procedure fields across revisions and evidence rows, retains
  content-free tombstone fingerprints, and suppresses re-proposal of forgotten
  evidence across scopes. Historical usage remains immutable. This does not mean
  source documents or already-sent model requests are erased.
- Latest-human selection reads actual human message rows, not document/tool text,
  and binds event identity/digest alongside the manifest. `conversations.py:343`
  persists that identity. Exact prepared-request usage is recorded in
  `responses_ledger.py:172`–`:173`; capability checks revalidate memory, and the
  existing send/publication paths use those checks. The post-I/O tests inspect a
  real correction during controlled transport. I did not execute transport/DB
  checks and do not claim a fresh send-race proof.
- Client correction/rollback commands retain the opened revision as CAS; I found
  no automatic CAS rebase in the inspected paths. Web correction offers an explicit
  human re-pin. Server-side target validation remains necessary even after fixing R4.

## Executed checks and available result evidence

1. `PYTHONPATH=backend backend/.venv/bin/python -m pytest -q -p no:cacheprovider backend/tests/test_memory_unit.py backend/tests/test_procedure_memory_unit.py backend/tests/test_tui_procedures.py`
   — **33 passed** in 8.96 seconds. Pure/offscreen tests only.
2. Five targeted pure probes described above: conflict selection, native late
   identity response, inner-result display, review confidence transition, and
   TypeScript rollback with API-shaped history. No DB/network involved.
3. `web/node_modules/.bin/vitest run --configLoader runner --cache=false test/memory-procedure.test.ts test/memory-commands.test.ts` from `web`
   — **43 passed**, 2 files. Initial default-loader attempt failed with EROFS while
   writing its temporary config under shared node_modules; the runner/no-cache
   command succeeded without changing implementation. These are fixture/static
   rendering/journal tests, not actual browser interactions.
4. `web/node_modules/.bin/tsc --noEmit --incremental false` from `web` — exit 0.
5. Pure schema comparison: `contracts/memory-v1.json` exactly equals canonical
   `MemoryContract.model_json_schema()`. Six relevant OpenAPI schemas match after
   normal FastAPI null-default removal/reference normalization. An initial strict
   comparison failed on that representation difference; inspection and normalized
   comparison resolved it. Generated aliases/routes inspected; no manual DTO fork
   found. This was not a full contracts regeneration/check campaign.
6. `git diff --check` — exit 0.

**Parent logs inspected, not executed:**

- `pg-first.log`: **26 failed, 34 passed**. Includes the SQL operator-precedence
  failure and missing frozen human-request identity. Current source contains the
  pertinent parentheses and identity-persistence repairs; this historical log is
  not evidence of current success and must remain retained.
- `pg-second.log`: completed during this review; **1 failed, 63 passed** in 131.68
  seconds. Failure is
  `test_procedures_parent_http.py::test_parent_procedure_tcp_lifecycle_race_restart_and_revoke`:
  posting the evidence message returned HTTP 422 `unsupported_operation` at line 15.
  The test therefore did not reach the procedure lifecycle/race/restart/revoke
  assertions. This log does not establish those later HTTP outcomes.
- No `pg-final*.log` was present at the final check (08:51 UTC). The aggregate logs
  do not supply a reviewed immutable manifest binding all results to the final
  changing integration. Do not infer all tests passed.
- Any old procedure test expecting adoption without new evidence requires a
  fixture/policy update. Keep the evidence requirement; do not weaken adoption to
  recover an obsolete expectation. The current old test source does not justify
  relaxing that boundary.

Actual browser desktop/phone journeys, native terminal/HTTP journeys, and narrative
and data transfer outputs remain parent-owned acceptance obligations. I did not
inspect completed outputs establishing those obligations and do not approve them
from test totals or implementation descriptions. The HTTP failure, R4, and the
missing asynchronous response tests particularly prevent a paired-client acceptance
claim. This is one bounded review, not a request for a broad new test campaign.
