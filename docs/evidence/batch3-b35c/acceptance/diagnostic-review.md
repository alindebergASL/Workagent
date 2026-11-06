# Isolated75 diagnostic delta review

PASS — scoped readiness for the separate fresh parent-run postfix proof. No material findings. This does not approve changing the active original cohort, retrying failed original requests, or claim live provider diagnostic/no-duplicate proof.

## Exact bindings

- Candidate execution manifest: `6f05444c949b03f30d4c013fbdec3780d0214ea5d9076847261fd6b27c6b2726`.
- Fresh-proof helper execution manifest: `27e05a037141fee76880ccde0c75cb6224a8ebafcf7b45e75a73449190c11c1c`.
- Candidate source: `e4c6bf2e1cebcd933ae2a901afdbd45ad3fb9ba78cce582f9803bf014c1cb25b`.
- Candidate consumer: `09dfaae5e2b261888185eecfe17a044aa784a8bbd9055245814d6a0093f24860`.
- `responses_transport.py`: `ad62266a3f1d59a00467889835de529b4b90a9385c2c2668560d1dcf7503c344`.
- `test_provider_failure_diagnostic.py`: `ed3a2396fa746514c90b148c979dc452ce8610755eeef4f958d874fe5f10c4dd`.
- Helper `proof.py`: `f8935e2aa1fe4dc37271f25feaa78e164b39c8c36a149fc184851c2e41a2ca07`.
- Helper `test_failure_report.py`: `20d1c139b47c5eea552bfa1732490dfe4b49bb858fea5deae5534250f8f0af9c`.

All 685 candidate file bindings, eight candidate execution-evidence bindings, 23 helper file bindings, and both evidence manifests matched. The preservation verifier passed for canonical source and frozen predecessors. The exact delta from the accepted gateway candidate is the transport file and its new test only. Migrations001–087, all capability descriptors, generated registry, and current decision schema are unchanged; source/consumer identities are freshly bound. Task, oracle, provisioner and funding SQL generator match their predecessor bytes.

## Direct review

`responses_transport.py:438–484` emits finite allowlisted code/type/param labels through the existing issue field, bounded to256 characters, only after the existing response envelope, model/tier, correlation and usage checks. Unknown/unsafe labels collapse to a fixed unavailable diagnostic. Message, raw error body, arbitrary parameter text and credentials are not copied. The failed result remains failed, with genuine usage or null usage unchanged; output items stay empty and no rejected-document diagnostic is added. Historical failed receipts with issue=None remain readable. No transport operation, retry, identity rule, count or ledger schema changed.

Helper `phase_safety`, `failure_report`, `retain_failure`, `visit` and `collect` preserve the failed outcome. Exact retained request/count hashes, attempt/phase grouping, single count/dispatch/identity/result, official provenance and result/identity/request/metadata agreement are required. The single failed result must be the latest phase without a staged tool/rejection result. Null usage is allowed only for that failed outcome; it does not imply zero cost or a refund. Diagnostic labels are independently revalidated before report publication.

A retained failure stops before launching another worker or reading its credential; a failure discovered after a visit stops further visits. Collection can report failure while the run remains running, emits collected=false and usefulness=false, and returns before material downloads. Failure reports are immutable and idempotent. No script creates a replacement request, response, result, native effect or success receipt.

Fresh preparation binds the new source/consumer and helper manifest to the exact physical store, grants, task and input tree. Original stores and the existing issuer are excluded as proof targets. The oracle stays outside worker inputs; credentials stay on stdin. Existing exact grant, release, role, funding-trigger and child-status checks remain. Per-output locking and explicit single parent-owned execution remain the bounded operating scope, with no automatic continuation loop.

Funding remains the ordinary existing issuer/recipient protocol. The documented initial amount is2USD; its deterministic phase1 certificate is idempotent, with issuer-first execution and same-certificate retry if recipient installation fails. There is no new pool, automatic extra funding, release/refund, or original credit transfer. Fresh issuer accounting and per-I/O recipient enforcement remain authoritative; raw grant ceilings are not funded amounts. No funding was issued by this review.

## Executed and reused evidence

Independent reviewer offline execution: **57 PASS in5.29s** —18 parser controls plus39 helper controls. These include unsafe diagnostic inputs, correlation/envelope/usage denials, serialization and legacy receipt compatibility, failed-running collection, pre/post-visit stop behavior, immutable report replay, forged history rejection, funding mismatches and unchanged source contracts. Helper DB/worker/issuer interactions in these controls are doubles, not actualPG or paid-provider proof. Candidate verification and evidence hash checks independently passed. A reviewer metadata check initially used the wrong TASK filename casing; the corrected read-only comparison passed.

Accepted predecessor68 pure/3 restrictedPG controls and migration proof are reused only for unchanged gateway/schema behavior. They were not rerun or promoted into new live diagnostic evidence.

## Limits

Actual fresh-store preparation, restricted-runtime integration, funding installation, paid provider result retention, browser/client usefulness and live no-duplicate behavior remain parent-owned future proof. Originals43/49/55 failed outcomes and unknown liabilities remain historical; originals61/67 are not diagnostic retries. Canonical69 and original records remain outside this candidate. No PG, provider, provisioning, grant/funding issuance, original mutation or installation was performed. Only this report and its JSON receipt were written; offline test scratch was isolated. Full-study and quality acceptance are not claimed.
