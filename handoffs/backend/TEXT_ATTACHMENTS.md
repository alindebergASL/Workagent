# Bounded text/code attachments — backend owner handoff

This increment extends the existing message input contract. It does not execute uploaded code, add a filesystem upload endpoint, grant permissions, or change provider/evaluation limits.

## Canonical client contract

Use generated `contracts/message-attachments.json` for admission parity. `AttachmentInput` in OpenAPI is still the request DTO.

- Supported lowercase extensions: csv, txt, md, py, js, jsx, ts, tsx, json, yaml, yml, toml, xml, html, css, sql, sh, wat, log.
- Filename must match the generated safe ASCII basename pattern and have at most 85 characters. Dotted basenames such as `parser.test.ts` are supported; paths, leading dots, empty dot segments, spaces and unsupported extensions are not.
- At most two attachments, 200000 UTF-8 bytes per file and in aggregate. Empty content, invalid UTF-8, lone surrogates and NUL are rejected. This preserves the prior content policy; it is not a new universal binary detector or malware scan.
- `.csv` requires `text/csv`; other admitted extensions require `text/plain`. File.type is not authoritative. No filename/content normalization.
- Preserve BOM, CRLF and content exactly. Browser decoding must use `new TextDecoder('utf-8', {fatal: true, ignoreBOM: true})`; JavaScript's default decoder otherwise drops a UTF-8 BOM. Hash and byte length refer to the retained content's UTF-8 encoding.
- Code, markup and attachment instructions remain inert, untrusted context. Do not render markup as HTML, evaluate JavaScript, invoke Python or select tools based on extension.

## Frontend work (Claude-owned, not implemented here)

Use the shared reader for initial Composer and existing-thread replies. Add attachment state to the shared conversation reply controller, full conversation and artifact ConversationPeek. Preserve exact target, command ID, attachments, and draft snapshot through pending/unknown delivery, reload and pane switches. Clear only a matching confirmed draft. Keep stale/held/closed/revoked and keyboard-send admission checks intact.

The backend already accepts attachments with exact target-bound existing-thread messages. This increment verifies that path via real loopback HTTP, PostgreSQL, ordinary admission, production worker with a labeled synthetic provider, exact command replay and canonical readback. It is NOT a browser or live-model pass.

## Verification

- New contract regression before implementation: 21 failures / 17 passes.
- After implementation: 38 focused pure tests pass.
- Combined 66-test suite passes on fresh PostgreSQL SQL001–022: new attachment tests/journey plus existing general Responses and HTTP/CLI journeys.
- Generated contract export/check and TypeScript drift/type check pass.
- Existing CSV/TXT basename limit, MIME behavior and aggregate caps preserved. Python script-shaped content reaches the model-context fixture unchanged, retains exact target/hash/byte length and does not create its sentinel file.

Frontend completion and exact-head browser verification remain required. No model/provider request, evaluation ledger change, migration, merge, deployment or external business effect is part of this increment.
