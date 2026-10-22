# Evidence continuity for ongoing work

New general-alpha runs pin `conversation-evidence-v1` at admission. Older immutable run configurations keep their historical context shape; stored requests, responses and receipts are never rewritten.

The runtime materializes a bounded, frozen evidence manifest for the current authorized conversation. Human-provided attachments without an explicit artifact target are conversation-level read-only evidence; targeted attachments remain scoped to the allowed artifacts. Scheduled pending-proposal evidence is restricted to the responsibility's artifact dependencies. Explicit human targets restrict proposal/targeted-attachment evidence to that artifact. Pending proposals must still be pending and based on the current saved revision.

`read_context(attachments)` returns the retained attachment evidence and eligible source material. `read_context(work_area)` includes `pending_proposal_evidence` with full eligible proposal bodies, explicitly marked unaccepted. Neither read adds mutation targets, accepts a proposal, or converts a proposed body into the saved version. Scheduled source material is filtered to explicit `source_version` observations before caps and omission counts; this does not authorize currently unsupported source-backed live admission.

Existing context/capability checks are reused before every broker operation. Evidence is rematerialized with current membership, source ACL/version, access generation, conversation state and current-revision/proposal-state checks. First materialization fixes proposal identities, and later proposals/messages cannot silently expand frozen input. Human edits continue to invalidate stale capabilities. Text is untrusted data, not authority.

Limits: 24 attachments, 20 proposals, eight eligible sources; maximum 32 KiB per evidence body sharing a 32 KiB aggregate body budget. Initial requests carry descriptors rather than duplicate bodies. Excluded content is not announced as available; permitted but oversized content carries explicit omission markers and byte counts. Large bodies can still be unavailable: bounded omission is not a claim that the source does not exist.

Regression coverage includes the observed attachment/proposal loss across scheduled work, natural human follow-up to earlier attachments, cross-conversation and unrelated-artifact isolation, human correction preservation, pending/accepted/dismissed transitions, frozen future inputs, source/materializer access checks, legacy context shape, and a full decision proposal larger than the former 8 KiB projection limit. Fake-provider tests are engineering evidence, not live model-quality evidence.

No database migration, external connector, frontend upload-cap change, or automatic proposal acceptance is introduced.
