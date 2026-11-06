# Post-freeze F1–F3 review

**HOLD — two finite required changes. F2 passes at the inspected scope; F1 terminal classification and F3 transition-receipt validation need the corrections below.** This is an engineering review of HEAD `50ec3a0a3347d98e074472f8590871d01800e492` plus the listed delta, not grading, historical replay, installation approval or full product acceptance. C/D remains unchanged.

## P1 — parser rejection does not establish provider termination

**Location:** `backend/workagent/general_responses.py:501–517`, used by `stop_terminal_response`, `run_checkpoints.py:46–49` and `evaluation/post_freeze_packets.py:13,20`.

`terminal_failure_bound` accepts every `malformed` result without examining why parsing failed. `responses_transport.parse_response` checks envelope/correlation/usage before it establishes a terminal provider status, and serializes the expected request metadata even when the actual response metadata mismatches. Thus comparing those serialized fields does not independently prove correlation or termination.

Independent pure reproducer using the actual parser: an otherwise correctly shaped response with wire `status='in_progress'`, a valid response ID, and another request's metadata produces `state='malformed', issue='response_correlation_mismatch'`. With the retained exact request/count/identity fields, the new predicate returns **True**. `require_observed` also accepts it. The same predicate can consequently permit partial/blocked settlement and replace an unknown/reconcile checkpoint classification despite no authenticated terminal result. No PG or network was used for this probe. This does not demonstrate an effect replay or an accounting release; it demonstrates false known-terminal/uncertainty classification.

**Minimum fix:** distinguish authenticated terminal output/schema failures from envelope, identity/correlation, usage-before-status, or indeterminate-status failures. Deny settlement for the latter; retain unknown/reconciliation semantics without retry. A conservative explicit classification of existing parser issue codes is sufficient; no transport framework or schema migration is requested. Apply the same distinction in the future collector: merely tightening `terminal_failure_bound` is insufficient while `require_observed` separately accepts arbitrary `malformed` at line20. Keep the existing exact schema-rejection path and genuine incomplete/failed/cancelled/refused handling.

**Focused closure:** actual-parser negative for `in_progress` with mismatched correlation (and envelope/indeterminate malformed controls); ordinary worker/checkpoint and collector must not call it safely settled. Preserve positive authenticated terminal failures and terminal schema rejection, with no resend or accounting mutation. Existing pending/native-unknown controls remain relevant. The current tests pass `issue='other_parse_error'` in mocked branches and do not cover this parser boundary.

## P2 — supplied stale/withdrawn proposal receipts can be silently ignored

**Location:** `evaluation/post_freeze_packets.py:117–135`.

`require_reviewed_transition` checks receipts only inside the current `service.proposals` listing. That API intentionally filters by current `memory_proposal_visible`. A receipt for a proposal whose producer/source authority was withdrawn, or simply for an absent/wrong-artifact proposal, can therefore disappear from the loop. No receipt-key completeness check or direct authorization read follows it. The function still returns the current artifact as reviewed, even when that supplied receipt names an old current revision/hash.

Independent offline probe: keep the current artifact readable, make the proposal page empty and direct `_proposal` authorization deny, and supply the previously retained receipt. The function returns success without calling `_proposal`. After changing the artifact from `r1/old` to `r2/changed`, the same stale receipt again returns success. This is a transition-proof omission, not a claim that the ordinary product API exposes withdrawn bodies or bypasses its own authority checks.

**Minimum fix:** validate every supplied receipt against an actually present, currently authorized proposal and the current artifact/revision bindings; deny absent/withdrawn/wrong-artifact receipt keys rather than ignoring them. Retain pagination and pending-proposal blocking. No obligation to review all unrelated historical proposals is requested. Add focused absent/withdrawn, wrong-artifact and stale-revision cases alongside the present accept/dismiss tests. No broad campaign integration or new receipt service is needed.

## Accepted inspected behavior and boundaries

- **F1 otherwise:** settlement reauthenticates the receipt, worker fence, provider/source configuration, current context and publication authority; revalidates exact stored requests/counts, contiguous bounded selections and prior observations; denies native uncertainty, orphan native attempts, cancellation/alternate-attempt ambiguity and missing observations. It preserves result/event/cost history, records honest `partial/blocked` and acknowledges the dispatch without synthesizing a final assistant response. Completed publication is unchanged. The P1 malformed classification must be fixed before this is a complete F1 closure. Conservative successor admission is intentionally unchanged, not automatic permission to retry terminal-failed attempts.
- **F2 PASS:** `file_input_rejection.py:94–105` returns only a fully decoded hash-invalid targeted create with the original `malformed/schema_validation_failed` result to existing076 rejection. Current receipt/context/publication/tool authority and absence of native attempt/uncertainty are checked. It neither executes the locally validated hash view nor catches arbitrary permission errors. Existing valid patch/078 and valid-hash targeted-create behavior remain distinct. Parent actual targeted rejection/restart, revoked authority, permitted patch and native-unknown regression proof is applicable.
- **F3 collection:** actual uncertainty is checked separately from explanatory `run.unresolved`. Packet state remains partial when appropriate; no success or score is inferred. Conversation-current artifacts/proposals are explicitly context, not all attributed to this run. Historical `run_produced_revisions` is a producer-run-scoped identity/hash list, **not a complete embedded historical body archive**. Bodies/downloads use ordinary authorized APIs. Backend downloads do not prove browser delivery. No collector integration into either frozen campaign exists; future callers must actually invoke collection and the corrected transition gate.
- **F3 operational review:** ordinary AcceptProposal/DismissProposal commands own CAS, current authorization and required whole-file/older-proposal acknowledgments. Protected text is checked before and after, accepted retry relies on the ordinary command ledger, and explicit acceptance is not human-effort measurement. P2 concerns validating the resulting receipts at the dependent boundary, not this mutation path. Calls/readbacks are separate transactions; the helper is not an atomic replacement for the dependent action's own authority/CAS checks.
- **Local safeguards, no change:** the supplied parent diagnosis identifies frozen B0's estimated41203 versus37000 packing ceiling, not exact provider50000 refusal or owner funding exhaustion. Current mandatory exact-count packing is already fixed; parent11 packing controls pass. Existing per-run units, actual selection ordinal/max_steps, exact count/reservation, grant read/generation limits and cumulative cost/carry remain unchanged. A fully settled partial can admit an ordinary new turn where current admission allows it; unknown or terminal-failed history is not blanket released. No cap increase, historical source change, frozen reclassification or paid replay is justified by this patch.

## Verification and actual evidence

I independently ran only the focused offline tests:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend:evaluation \
  env -u DATABASE_URL -u WORKAGENT_TEST_DATABASE -u WORKAGENT_TEST_ADMIN_DATABASE \
  backend/.venv/bin/python -m pytest -q -p no:cacheprovider \
  backend/tests/test_post_freeze_terminal.py backend/tests/test_post_freeze_packets.py
```

**41 passed, 1 deprecation warning, 6.66s.** Additional read-only Python probes used the actual parser/terminal predicate and mocked service proposal enumeration as described above. They exposed the two gaps; they are not PG authority proof.

Parent `parent-final-pg-01.log` completed during review: **17 passed, 1 deprecation warning, 246.33s**. The two new PG files account for14 cases (12 terminal/rejection/partial cases plus2 operational review cases), with3 existing patch/native-unknown/provider-unknown controls in the writer's serial command. This is actual restricted disposable-PG/controlled-transport evidence supplied by the parent, not paid model usefulness and not execution by this reviewer. No concurrent PG was run. `parent-packing.log`: **11 passed in26.60s**, reused narrowly. Writer41 offline proof also preserved; it is not counted as an additional distinct41 cases. Historical debug fixture failure remains retained and is not retroactively passed.

All9 source/test bindings,5 artifact bindings and88 migration bindings in the writer manifest independently match current bytes. All88 migrations are also byte-identical to HEAD. Canonical registry equals the proposed catalog; git diff changes only `implementation_sha256` for `connectors.github.discover` and `connectors.github.read`, with no schema/API changes. Consumer hash recorded by the candidate is `0ab8bb1f27b1784dc8ac4190123ded33796aa138adf4e556274f6c0f237e5ac1`. Historical grants/pins are not rewritten by this review or patch. Preexisting STATUS/authority/fresh72 helper/lock changes were not incorporated into the product review.

No additional PG command was executed or authored by the reviewer. After the two bounded changes, parent owns exact-source checks and any selected integration rerun; these passing results remain valid at the inspected pre-correction scope. No broad suite, R1/R3 repeat, cohort replay or new approval layer is requested.

## Exact reviewed bytes

| File | SHA256 |
|---|---|
| `backend/tests/test_post_freeze_packets.py` | `5a966e649e1050f16730e46031165ddbceb26da3ef1c02fa1d09884ef214f668` |
| `backend/tests/test_post_freeze_review_pg.py` | `aa5bf9b4287be75c0d30576b81e10b0e960fd5aeec839e61079e23d9c5b58aef` |
| `backend/tests/test_post_freeze_terminal.py` | `394e012f539eb4db07e16b8564e6bd63457261fb809bd087dacbdec4a3074590` |
| `backend/tests/test_post_freeze_terminal_pg.py` | `069d91e1e66f16f71bd4f583addd8404912b3c2cd54c4a71dfd0a9c99e5422e8` |
| `backend/workagent/file_input_rejection.py` | `5be59233027006b1a3513b8a2fb5b9137f4fc215fa1ff50a7bc873fc43803f35` |
| `backend/workagent/general_responses.py` | `8ce1208e7fc83b0f744d0568afbe6cd4f6ef3442f73ea5e4ea53765d51eece5f` |
| `backend/workagent/general_worker.py` | `0fa562241817cc072b1b7389d3f352b797de747aa2f89b42d2c70b538f205f7a` |
| `backend/workagent/run_checkpoints.py` | `79488d78ba327256e501c09e04ef2e02f7976f193b46c9e578678434cddbf4f9` |
| `evaluation/post_freeze_packets.py` | `5a0e9c3bc6b50e9f449395626e20f5efbfe4f8ea64412405203c89bd83c28a5c` |
| `contracts/capability-registry-v2.json` | `16ee2112757a055b40e39890767e7769243ee53c82a9f82e6cab81fb32e08617` |

Evidence bindings:

- `parent-final-pg-01.log`: `e0a0dcba670a799aafcdaa52eae002963c5da54f8f4a0abee81d66e70cb19760`
- `parent-packing.log`: `d790b5bd342817fd180f103a6e0e1b1a639f1ab5feb7aa33d873089252e786b3`
- `offline-freeze.log`: `4c6b00a1c45db6926b75182fff0a132aa123b9c0104c9330108e7a68c290eb08`
- `MANIFEST.json`: `79a67764334ee752c908fede7ae9f2213532aadce2f48ee226ae094a981130b5`

The report is the sole review artifact written. No implementation/material/DB/provider/funding/installed-state mutation, commit, agent dispatch or study scoring was performed. Frozen negative/inconclusive cohorts and unknown histories remain immutable. Development/review-tool costs are outside the product ledger and unreconciled; this review makes no billing claim.
