# Independent bounded saved-work retrieval review

**Exact tested SHA:** `ce7c4d716fbe90304f3fcda6afc69af6d1f47481` (`ce7c4d7^..ce7c4d7`).

**Outcome:** two concrete gaps against the requested preservation / SQL receipt-integrity guarantees. Ordinary broker authority, current-revision checks, bounded retrieval, and pending-only publication passed the exercised cases. Neither finding demonstrates automatic acceptance or cross-conversation disclosure.

## 1. Protected human note can disappear from a proposed revision while the trusted reason claims it was retained

**Severity:** medium; blocker for claiming protected-note preservation in this path.

- New omitted-body edit admission: `backend/workagent/general_responses.py:183-201`.
- `backend/workagent/products.py:175-184` returns a `PublishArtifact` body unchanged; publication calls `_validate_flexible_edit` at `250-252`, but `backend/workagent/flexible_work.py:7-12` only protects structured-table edits, not document protected-note blocks.
- `backend/workagent/products.py:261-265` nevertheless writes the trusted proposal reason: **“Model-selected local result; saved human notes retained. Review before acceptance.”**

**Reproduction:** `test_protected_note_omission_probe` in the supplementary test file below creates a human-saved >8KiB document with the existing Unicode/newline protected note, posts an untargeted human request “Shorten the first section; keep my note.”, reads the exact full body, then submits a controlled model publish decision removing only protected-note blocks and shortening the section. Real restricted PostgreSQL and production worker return `partial`; authorized readback finds one `pending` proposal lacking the note and carrying the false preservation reason. The current saved revision remains unchanged.

This is an inherited publication-validator gap exposed through the newly admitted omitted-body edit path, not a new automatic overwrite. The committed positive test copies the note faithfully itself and therefore does not test enforcement against an omitting model. Preserve protected blocks from the exact base or reject their unauthorized deletion/change; do not claim retention merely because a proposal was created.

## 2. SQL025 accepts forged read receipt identity if the caller updates the unkeyed verification hash

**Severity:** medium defense-in-depth / evidence integrity; blocker for the requested “cannot forge receipt” SQL guarantee. Requires the restricted SQL writer, not ordinary model output.

`backend/migrations/025_saved_work_retrieval.sql:16-18,48-82` binds the selected decision, current body, scope, bytes and `base_hash`, but never compares the other `binding` receipt fields to the retained result/step. The generic verifier at `backend/migrations/020_responsibility_continuation.sql:243-259` checks an unkeyed digest of the supplied staged object, not that receipt identity against the actual selection receipt.

**Reproduction:** `test_independent_sql_receipt_mutations` stops immediately before legitimate read retention and inserts a copy through the restricted runtime database role. Change `binding.selection_response_id` to `forged-response` and recompute `verification.automatic.staged_sha256` over `{status,body,file,output,binding}`. The insert succeeds and exact readback confirms the forged identity. Removing `verification.automatic` instead also succeeds, because SQL020:232-236 allows absent automatic evidence for non-completion observations. Each insertion is rolled back after readback.

Evidence in `independent-negative-tests-v2.txt:1`:

- `receipt_rehashed: ACCEPTED (read back; rolled back)`
- `receipt_without_automatic: ACCEPTED (read back; rolled back)`
- Simple one-field binding mutations without adjusting verification were rejected, so testing only those would miss this.

SQL025 should independently compare attempt ID, selection request hash, response ID, decision hash and operation hash against the immutable retained selection/step, not rely on a recomputable observation digest. SQL024:172-186 provides an existing example of direct receipt binding. Python `resolve_selection` recomputes the binding; this reproduction does **not** establish a model-accessible forgery or publication bypass.

## Verified positive coverage

- Independently reran committed retrieval suite on newly provisioned disposable PostgreSQL: **26 passed** (`independent-retrieval-tests.txt`). This exercises exact >8KiB retrieval, shared 32768-byte budget, explicit size-limit/no truncation, unread publication denial, cross-conversation and explicit-target-switch denial, wrong hashes, revision/membership/grant changes before read/after read/before publication, restart, pending proposals and unchanged current revision.
- Reran selected pre-existing alpha guard tests: **9 passed, 14 deselected** (`independent-alpha-guard-tests.txt`): direct answer/non-completion, guidance revocation, exhausted read steps, and forged guidance evidence.
- Supplementary probes: **3 passed** (`independent-negative-tests-v2.txt`). These are characterization tests: they confirm both defects, not a clean security result. Actual parent-revision policy/schema/consumer hashes were computed from git and each independently rejected by current `validate_grant` with `unsupported_operation`. No old grant was repinned or used for a provider call. `saved_work.py` is now part of the consumer hash. Successor compatibility validation still checks policy/schema.
- Programmatic comparison confirmed SQL025 preserves the SQL017 guard body exactly after removing the new read branch and enum entry. Existing NULL-terminal behavior is inherited: a read with `terminal_outcome=null` was accepted by SQL; no completion/publication escalation was demonstrated.
- Read index derives only from frozen work-area artifact IDs; normal selection reconstructs and hashes context and rechecks current target. Full retained reads must precede omitted-target editing. `_check_capability`, `check_pins`, and the event/publication triggers retain current membership/grant/lease checks. Read observations remain reply/continue-or-limit with no product output and no satisfied goal.

## Reproduce

From `/home/ubuntu/workagent-overnight-20261015/backend`:

```bash
source ../.local/overnight-batch1/independent-review.env
env -u PYTHONPATH -u PYTHONHOME /home/ubuntu/workagent-adaptive-execution/.venv/bin/python -m pytest -q -s ../.local/overnight-batch1/test_independent_saved_review.py
```

## Scope, artifacts, limitations

All reviewer-created files are under `.local/overnight-batch1/`: this report, `test_independent_saved_review.py`, `independent-review.env` (chmod-600 disposable credentials; not printed), and `independent-{retrieval-tests,alpha-guard-tests,negative-tests,negative-tests-v2}.txt`. Provisioned only own disposable database `workagent_test_1d16714c4972`; retained for reproduction. No tracked files, SQL001–024, web files, live checkout, host/profile/controls, or historical live authority were modified. Final git HEAD remained the tested SHA with no tracked diff; pre-existing untracked `STATUS.md` was untouched.

Bounded review, not exhaustive concurrency/fuzz/SQL-role audit. No product-model call, spend, live credentials, UI, or browser execution. Controlled providers test broker behavior, not model judgment. No new test of lease-expiry restart, every editable body type, or cross-workspace SQL snapshot tampering. One pre-existing Starlette/AnyIO deprecation warning; no execution blocker.
