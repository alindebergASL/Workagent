# Independent narrow authority P2 recheck

**Verdict: PASS — the original P2 is closed by append-only corrective evidence and the future harness exact-target fix.** This does not retroactively make the historical receipt accurate. All other findings, limitations, and dispositions in `.local/criteria-authority-review.md` remain preserved; this is not an overall review, acceptance, merge, or deployment approval. The original unknown count remains unresolved.

Candidate remains `9a009c6467369716a5e1d0c0d6f3b83337a2da8a`. This review examined only the P2 correction and its preservation boundary; no full suite, generation, retry, or provider call was performed.

## Evidence identity and retained history

Read the initial authority review, historical `criteria-execution-02/frozen.json`, archived `operator-script-as-executed.py`, current `criteria-regenerate-02.py`, `criteria-freeze-readback.py`, and corrective receipt. The archive/current script diff contains only the two intended fixes: checking both predecessor active flags and writing the failed predecessor identifier in the future freeze receipt.

Independently recomputed SHA-256 identities:

| File | SHA-256 |
| --- | --- |
| Historical `criteria-execution-02/frozen.json` | `b34b184efcbcb585e8264603479d952b6e89923682df6e0dc4ca2c0e6aded573` |
| `criteria-execution-02/frozen-corrective-readback.json` | `fc6f4d58d848fa9874e4745369370553aa8c9b64f5a751305e5684e51ffb9c03` |
| Archived `operator-script-as-executed.py` | `c7f1b05761f940a039092145078c7e409e26687ccee0e861345768c804af6c12` |
| Original `criteria-authority-review.md` | `a0370b8e7bd6c9615a885746a57e7e33b9ff2e5d6fc227c66afe3e66a9a1cc6b` |

The historical receipt still names `workagent-flexible-live-20261009-05`, preserving rather than concealing the defect. Its exact bytes match the corrective receipt's historical hash. The corrective receipt is explicitly a later read-only observation and identifies the actual failed predecessor, `workagent-flexible-criteria-clarification-01`. It does not claim to reconstruct an original revocation-time readback.

The corrective writer reads predecessor rows by exact identifiers, requires both inactive and their immutable `data::text` equal the pre-second-attempt snapshot, and creates the new receipt with `O_EXCL`. It contains no revocation or other database mutation. It was inspected, not rerun, to avoid rewriting existing evidence.

## Independent live readback

Used the existing scoped runtime credentials without printing them. A PostgreSQL connection enforced `default_transaction_read_only=on`; the transaction explicitly used `REPEATABLE READ READ ONLY`, checked the exact intended database and read-only state, and ended with an explicit rollback.

- Both exact predecessors are inactive. Each immutable grant body equals the retained pre-second-attempt body byte-for-byte; the snapshot's own SHA-256 also validates.
- The failed predecessor's grant-body SHA-256 is `7ac9660bd1f681f540ca4f85845a2614dfb0288df8fe8e127936cf06215170b8`; the original predecessor's is `22dc5d51c970766de773af72a2533ff89dd08851b3001723d98cc33cc9bd9af4`. Both match the corrective receipt.
- The current grant remains active and its entire stored data equals its retained grant file, including pins. No grant inventory change was found.
- All **276 pre-second-attempt rows across 28 snapshot tables** remain present byte-for-byte. Protected history sets and all carry rows match exactly. This is preservation checking for the correction, not a fresh review of unrelated application behavior.
- The entire shared budget equals the corrective receipt: **$4.88104** reserved, including **$3.42992** carry; **12 counts, 11 dispatches, 106 reads, 0 cancels**. No counter reset or evidence purge was found against the retained baseline/receipt.
- The failed predecessor's final phase still has exactly one `count_send` and no other final-phase event; its run remains `running`. **The original count-unknown is still unresolved**, not converted to success by this correction. Zero unknown dispatched-generation usage does not resolve it.

## Future harness verification

Executed **8 passing pure spy cases**, with socket creation forbidden and no real database/provider access or file writes:

1. Both predecessors inactive: pass; exact query targets are original then failed predecessor.
2. Failed predecessor active: reject before budget check.
3. Original predecessor active: reject before budget check.
4. Failed predecessor missing: reject before budget check.
5. Original predecessor missing: reject before budget check.
6. Archived checker reproduces the defect: it permits the failed-active state because it queries only the original predecessor.
7. Archived freeze reproduces the mismatch: mocked revocation targets the failed predecessor, but the captured receipt names the original.
8. Current freeze aligns mocked revocation, actual checker query targets, and captured receipt: the action/receipt target is exactly `workagent-flexible-criteria-clarification-01`, and both predecessors are read back.

The future harness is validated with its intended pre-execution budget stub; its live freeze command was not rerun against the already-consumed second-attempt budget. No real revoke operation was invoked.

## Preservation and disposition

Before/after hashing confirmed **43 existing evidence/review/script files unchanged**, with the evidence-file inventory unchanged. `git diff --exit-code HEAD` passed; HEAD is exact. The pre-existing untracked `scripts/verify_criteria_view.mjs` remains outside this verdict. Only this new sanitized report was written by this reviewer.

No application or tracked-work changes, receipt rewrites, evidence deletions, database mutations, provider calls, pin changes, commits, merge, deployment, or issue closure were performed. No recheck blocker was encountered. Preserve all other original-review conclusions and keep #13 / the overall multi-review decision open for parent integration.
