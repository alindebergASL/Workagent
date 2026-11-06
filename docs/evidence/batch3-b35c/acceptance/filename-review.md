# Isolated filename-delivery candidate review

**Scoped PASS. No material runtime or read_saved.py defect found.** This is candidate review and saved-material readback closure, not deployment, future dispatch compatibility, fresh-model success or full client acceptance. Original29 collected/3 failed/40 not-runnable dispositions and their grades are unchanged.

## Exact bindings

- MANIFEST SHA256: `89ce60e81a4148662f025251c6136558b64e33576554f0e5ad7912abb0136fee` (685 candidate files,14 bound evidence files).
- Source: `0c3b6e4e9039b1f6580d2b66a28c4abb032f9d157772874602feea75491792a5`.
- Consumer: `767c70733c62e36051aaf314d6af75adbd7d07ff94104634d73d0730497ed8fb`.
- read_saved.py: `0fcb0b4232d2b9450d565893fad08ef6ec6794f8e9633ce9b17e2ddac741ef9e`.
- filename-delivery.patch: `0ec41108205a252c55cf8a3d62e59bcd81380ea10a3d76d8f91bea92b10d3b1e`.
- Focused test file: `27e902804fefea5586198a134c0b38f256931fc7af03667314991f00a5efe027`.

The offline preservation verifier passed. Exact changes are four runtime files and three regenerated contracts; FileBody and migrations001–087 are unchanged. All11 evidence-manifest file hashes match. Independently recomputed source, consumer, dependencies, catalog, release IDs and current gateway schema match IDENTITY_CANDIDATE.json. Fifteen descriptors change implementation hashes; exactly two also change output/schema hashes. Runtime file hashes and parent readback receipt hashes are recorded in REVIEW.json.

## Runtime assessment

`products.py:793–817` preserves scope, artifact owner/document and source-dependency checks. Revision downloads check current visibility and the exact requested revision as get_artifact did; an old revision remains the selected body, not the current body. Proposals retain proposal visibility/dependencies and exact artifact association, and simultaneous revision/proposal selectors are rejected. All body authorization and metadata lookup now share a transaction.

`workspace_files.py:13–35,80–90` adds a delivery-only immutable value rather than modifying historical FileBody. Optional association metadata is reauthorized through the existing owner/document file reader and cannot supply content or select another revision. The chosen UTF-8 body/hash remains exact, including BOM and CRLF. The native Filename validator rejects path separators, quotes/control characters and unsupported extensions; extension-specific MIME matching prevents arbitrary header/media-type substitution. The existing attachment/nosniff/hash HTTP response path is preserved. Ordinary non-native FileBody, tool and table behavior remains intact.

`artifact_exports.py:21–28,123–144` derives a safe ASCII basename for newly retained exports only. Extension/MIME comes from the supported requested format, and conversation/artifact association must agree. Rendered bytes, hashes and original input authorization are not replaced by metadata. Non-file artifacts keep export.<extension>. Existing download_export code still validates and returns the retained old manifest, reauthorizes its original dependencies and reads the saved bytes; old export.md/export.csv names are not repaired retrospectively.

`workspace_file_models.py:198` genuinely broadens ExportFilename. Both artifacts.export and artifacts.export.office have new output/schema hashes in the generated contracts and catalog. They MUST NOT pass through schema-preserving release adoption or a rewrite/alias of old grant pins. COMMANDS.md states that boundary explicitly; there is no installer or bypass in this packet. Any later execution adoption must represent the schema change honestly. Other descriptor deltas are implementation-only, with input, permission and resource contracts unchanged.

## read_saved.py assessment

Preflight binds the frozen candidate/predecessor, exact proof inputs, prepared DB identity and source, completed/reaped proof child receipts, and exact import tree. Routing requires matching local DB endpoints and distinct owner/runtime usernames; runtime transactions verify current_database/OID and current_user/session_user against the retained target. The helper takes the proof's existing lock, checks the runtime role and saved READY run, then uses ordinary authenticated download_product/download_export calls. It does not execute a worker, generate files, create exports, install releases, issue funding or change grants.

Runtime service reads run inside force_rollback while retaining authorization locks. The separate owner connection is used for static SELECT table snapshots, also rolled back. The SELECT/WITH/SET prefix restriction and Python socket audit hook are supplemental controls for this fixed program, not a general sandbox for arbitrary SQL or native code. The reviewed call graph is bounded to those reads and source-checked service code; no mutating call or arbitrary query input was found. Output is a new directory; errors retain only type/domain code, and the finalizer compares all table snapshots. Old proof outputs and the false original delivery assessment are preserved.

No material read_saved safety hole was identified in this exact parent-controlled scope. The reviewer did not run it or connect to any database.

## Executed evidence and limits

Reviewer: **39 focused offline controls PASS in3.89s**. They cover exact current/old/proposed bytes; owner/workspace/membership/revision/proposal/dependency denials; incompatible selectors; filename/MIME/header injection; ordinary FileBody/table behavior; future export retention with unchanged bytes; old manifest validity and revoked-dependency denial. The HTTP handler is invoked directly, not through a socket/browser. SQL is doubled: these tests do not substitute for actualPG authority proof.

Parent results, available during review: both parent-read-before-01 and parent-read-after-01 report PASS under the exact predecessor/candidate source identities. Before returns content.txt/text/plain for both products; after returns repair-clinic.md/text/markdown and repair-clinic.csv/text/csv. The Markdown/CSV hashes are unchanged. Both still return the original export.md and export.csv manifests and bytes. Successful completion includes the helper's unrelated-owner/workspace denials. Each preservation result reports76 tables equal; independently comparing all four BEFORE/AFTER snapshots also shows exact equality across the two runs. No installed release binding was replaced. Original collection still records named-delivery=false.

This actual evidence is a restricted-runtime human-service replay of already saved material, not new model generation, new export creation, worker/dispatch adoption or browser usability. Actual new-export creation under the broadened schema and schema-aware future execution adoption remain outside this closed readback scope. Actual historical/proposal/revocation coverage is not inferred beyond the stated offline controls and unchanged authorization paths. No broader suite was rerun.

Only review/REVIEW.md and review/REVIEW.json were written in the candidate, plus isolated offline test scratch under /tmp. No canonical or proof-state edits, source repair, provider/service/database call, new agent, worker, funding, grant or installation action was performed by the reviewer. Historical generic-name failure and original-cohort grades remain intact.
