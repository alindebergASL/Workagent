# Model input budgets and retained work

The model input is a projection, not the record of work. Frozen run context,
canonical saved revisions, human edits, prepared requests and receipts stay intact.
Only newly prepared requests use the current projection. Already prepared steps
must retain their exact bytes and historical policy/limits.

## Packing

`request_packing.prepare_selection` measures the complete count payload: policy,
function/schema declarations, context and accumulated observations. With a 50,000
input ceiling, selection packing targets at most 37,000 locally estimated tokens:
5,000 estimate/formatting margin plus 8,000 reserved for subsequent tool/response
history. Each new selection is packed again. Finals retain all provider output
and tool results and are checked against a 45,000 local-estimate ceiling.

The estimator uses pinned public o200k_base ranks locally. It is NOT a claim that
this model uses that tokenizer or that local component counts equal billing. The
existing provider token count of the exact prepared payload remains authoritative
and mandatory before generation. Overlarge mandatory input is rejected intact;
there is no truncation of current human input or silent provider truncation.

`project_context`:

- Removes the duplicate top-level instructions/tool copy.
- Replaces identical bodies in recognized document/product slots with JSON
  pointers and hashes to a complete body already in the same input. Different
  revisions are never conflated. Explicit target and dependency identities stay.
- Replaces inactive initial-index lifecycles with bounded descriptions, explicit
  omissions and a `read_context(section='work_area')` reference. The currently
  bound responsibility and active lifecycles remain whole. The read returns only
  the already-authorized frozen work-area snapshot, not another conversation or
  workspace, and does not grant execution or prove a goal.
- Preserves full lifecycle details in explicit read observations. Identical
  document bodies within those reads may reference an earlier complete body.
- If needed, drops whole older assistant messages first, then older system/human
  messages. The current run's human/system input and latest human message are
  protected. Omission counts are explicit. Mandatory tool observations and current
  bodies are not silently cut to fit.

Earlier discovery-schema deduplication remains in `adaptive.continuation_context`.
Durable history and older complete handover plans are not rewritten or deleted.

## Installation and offline behavior

Use the Python version supported by the pinned backend requirements (the private
runtime uses Python 3.12). Install `backend/requirements.lock` and the separately
pinned local-tool engine as required by the runtime. Explicitly run:

    python scripts/cache_tokenizer.py

This installer downloads only the fixed public tokenizer URL, verifies its pinned
SHA-256 and installs it in `~/.cache/workagent/o200k_base.tiktoken`. Request handling
never downloads tokenizer data. Missing/corrupt cache falls back to a conservative
UTF-8-byte count, not fabricated token counts; restore the cache before live tests.

## Measurements and tests

Each newly prepared request emits a content-free `request_input_budget` event with
request hash, phase, local estimate, estimator label, ceiling, byte size and fixed
component names. No document text, prompt snippets, account values or URLs are in
these metrics. Component estimates are not additive provider counts. Exact provider
counts and usage remain in the existing append-only step journal.

`test_request_packing.py` exercises large histories, eight growing observation
steps, preserved current input, different document revisions, offline estimation,
explicit size refusal and exact historical schema fingerprints.
`test_request_packing_runtime.py` uses the production worker and restricted-role
PostgreSQL with controlled HTTP to check scoped retrieval, unchanged canonical
bodies and restart behavior. Controlled tests are not live-model quality evidence.

Increasing the request-size limit must update Python and database reservations
consistently. It does not reset spending, forgive unknown sends, create a second
allowance, or change the cumulative $100 development ceiling. Activation and live
verification are recorded separately in STATUS.md.
