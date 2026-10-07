# Independent supplied-check checkpoint

## Outcome and scope

Optional `PostMessage.acceptance_checks` now accepts a closed bounded specification under the existing adaptive authorization. Wasm supports 1–8 cases with an explicit export, up to 8 bounded integer arguments and exact signed-i64 decimal-string expected returns. CSV supports an exact total and discrepancy count. This is a human-only API field, not a model tool or inferred approval.

The real local executor evaluates those checks against staged output. A model example passing while a supplied check fails causes another bounded attempt. Supplied checks passing can save the useful result even when the model's own expected value is wrong. The response explicitly says what passed and **does not establish correctness beyond those checks**. The run remains `partial`, `requested_goal_status=needs_validation`, and `satisfied=false`. This is not generalized goal verification or adaptive milestone completion.

The immutable evidence retains the full human specification, request/body/operation bindings and check results. PostgreSQL migration013 validates admission, bounded shapes, exact source and hashes, completeness and pass-flag consistency. No earlier migration was edited. No new tables, execution privileges, endpoint or model tool were added.

Initial, continuation, final and historical provider inputs omit the full check specification, expected results and specification/request hashes that encode them. The model sees only a bounded supplied-check pass/fail/count summary. Absent optional checks preserve legacy command and message serialization/hashes.

## API example (synthetic)

Existing authenticated `POST /v1/workspaces/{workspace_id}/conversations/{conversation_id}/messages`, with the ordinary schema/request/command IDs, work version and prompt:

```json
{
  "acceptance_checks": {
    "kind": "wasm_cases",
    "entrypoint": "total",
    "cases": [{"arguments": [11, 123457], "expected": "1358027"}]
  }
}
```

This snippet is the additive field, not a complete HTTP request. The authorized conversation read exposes typed evidence at `turns[].adaptive.steps[].verification.acceptance`, including `scope: supplied_checks_only`. Generated OpenAPI/TypeScript are updated. No frontend input/control was added; the existing web owner retains that scope.

## Verification status

Candidate runtime consumer hash: `50175584b41f838cccf9f5ed772ed7fb14a5d59c9fc035fac6b82fac743425b0`.

- Provisioned a NEW isolated DB using unchanged `backend/dev_db.py`: `workagent_test_bc87278a7789`, env `.local/acceptance-checks-v1.env`. Readback confirmed all 13 migration checksums and a nonowner runtime role. Protected/saved databases were not reused or modified.
- RED observed before implementation: new pure-test module could not import the absent acceptance implementation. Final pure execution and existing adaptive pure tests: **39 passed** in a fresh parent run after review.
- Initial focused PostgreSQL run:37 passed across independent-check integration, existing adaptive execution and adversarial guards. Added CSV publication, stale human edit, authenticated HTTP admission/readback, strict SQL/Python input-shape parity and legacy serialization cases passed in targeted reruns. These counts are not a claim of one complete full-suite run.
- Canonical export, generated TypeScript drift, `tsc --noEmit`, and diff hygiene passed. The npm wrapper assumes `backend/.venv`, absent in this worktree; equivalent checks used the actual root `.venv` directly. No package-script change was needed.
- Added-line static scan found no hardcoded secret, shell-injection, dynamic-execution, unsafe-pickle or formatted-SQL patterns. This is not a substitute for independent review.
- **Full backend regression: pending.** Running against the new DB only; local log/XML `.local/acceptance-checks-full.{log,xml}`. Do not count the old508-test checkpoint as verification of this delta.
- **Independent review: PASS.** One read-only GPT-6 Astra reviewer reported no blocking security or logic defects on the exact consumer hash above, and 39 pure tests passed. It inspected, but did not execute, PostgreSQL integrations. Nonblocking suggestions were explicit missing/JSON-null SQL mutations and an additional integration-level request-hash secrecy assertion; existing pure/hash-redaction and forged-receipt tests cover the related boundaries, but those additional cases are not claimed. No runtime change followed the review. No explicit provider API or Workagent calls were made for the review.

Engineering is an independently reviewed backend checkpoint with focused database verification; the full regression result is explicitly pending. This checkpoint may be committed as coherent progress, not represented as fully regression-verified or release-ready. Usefulness and experience remain unverified for live model behavior and UI. No new live provider generation, web edit, merge, push, release, or deployment was performed. Existing grants remain pinned to their original consumer hashes; this candidate does not silently retarget them or reset any cumulative liabilities.
