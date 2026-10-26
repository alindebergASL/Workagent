# Operator proposal review and exact replay

The script CLI and existing curses console both use `OperatorClient`. The current
script entry point remains `python -m workagent.operator_tui`; there is no separate
`operator_cli.py` in this checkout. These commands admit HTTP mutations only; they
do not run a worker, complete a goal or authorize external publication.

## Review before choosing acknowledgements

With the existing local API/token/workspace environment configured, first read:

```sh
python -m workagent.operator_tui --workspace WORKSPACE review PROPOSAL ARTIFACT REVISION
```

`review` is read-only. It returns the full selected proposal, the artifact at its
exact base/current revision, and the **server-provided** review projection. It
refuses a mismatched proposal/artifact/base, a nonpending proposal, a changed
current revision or missing server review policy. Compare the full candidate and
base; the server's removal preview is bounded and is not the complete body.
No alternate local structural-loss/latest-candidate algorithm is used.

After reviewing that exact candidate/base, choose only the acknowledgements you
intend to grant:

```sh
python -m workagent.operator_tui --workspace WORKSPACE --command-id NEW_ID \
  accept PROPOSAL ARTIFACT REVISION \
  --acknowledge-removed-content --acknowledge-older-proposal
```

Both switches are optional and **false by default**. They are deliberate user
assertions that this candidate/base was reviewed, not inferred from a warning,
server error or earlier command. Omit either switch unless you mean to grant it.
The CLI cannot prove that a person read the displayed text. The server remains
authoritative and rechecks review policy, pending status and exact revision CAS at
acceptance; a review read is not a lock or permission to rebase stale content.

In the curses console use the same explicit commands after `:`:

```text
review PROPOSAL ARTIFACT REVISION
accept PROPOSAL ARTIFACT REVISION --acknowledge-removed-content --acknowledge-older-proposal
```

Acknowledgements apply only to that accept invocation. They are not sticky across
refresh, candidate selection or subsequent commands. `proposals ARTIFACT`,
`artifact ARTIFACT` and `history ARTIFACT` remain available for inspection.

## Unknown outcomes and frozen journals

All newly prepared commands use envelope **format 2**. New accepts always store
both acknowledgement booleans, including explicit `false`. Legacy **format 1**
uses its frozen validation grammar: accept bodies contain neither flag, and
follow bodies support only `attachments: []`. Do not widen that grammar to admit
new inputs or insert defaults into an existing record.

The journal still reserves an exclusive command ID before the first POST. It
never migrates stored records. Outcome/receipt metadata may change, but the
command record and digest do not. Replay validates under the stored format and
sends the stored body, not the reconstructed validation value. Command ID,
request ID, scope/path, target revision/hash, text whitespace/Unicode and supported
attachment representation remain unchanged. Nonempty attachments were not
supported by format 1; they remain rejected without mutation, not silently
removed. Attachment ingestion is outside this slice.

After an uncertain response, inspect the exact saved command and domain state:

```sh
python -m workagent.operator_tui --workspace WORKSPACE command COMMAND_ID
```

Only if exact command replay is appropriate, request it explicitly:

```sh
python -m workagent.operator_tui --workspace WORKSPACE replay COMMAND_ID
```

Replay performs no fresh preflight/CAS fetch and accepts no new acknowledgement
switches. There is no blind retry or automatic consent upgrade, including after
`review_required`. Reusing the same ID for a new payload is refused before any
network request. If a known rejection requires different consent, review again
and issue a separately chosen new command ID; do not use a new ID to work around
an unresolved unknown outcome. Responsibility resumption is not command replay.

The private journal contains unredacted prompts and receipts, never the bearer
token. Keep it private. Entire journal-file bytes can change when outcome metadata
is written; the preservation guarantee concerns the immutable command record,
its digest and the outgoing JSON payload bytes, not outcome metadata.

## Offline verification

`backend/tests/test_operator_review_ack.py` covers false defaults, independent
explicit flags, CLI and curses wiring, server denials without retry, invalid
versioned records, exact review reads and literal format-1 fixtures for every
legacy write action. It intercepts actual urllib Request bytes and compares
pre/post-replay payloads plus record/digest identity. Existing operator client and
replay suites cover unknown POST/readback boundaries and private-journal safety.
All fixtures are synthetic; these tests need no provider or live database.
