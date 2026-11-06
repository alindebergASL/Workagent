# B3.0a — capability boundary and shared accounting handoff

**Narrow slice complete; Batch 3 is not complete.** Accepted base:
`26e599b3db8a61b73eeeaea4f87a1d3de0b296d9`. Implementation is committed on
`hermes/b2-conversational-client`, not merged or installed into the development
runtime by this card. Canonical interface:
[`../../plans/batch3-tool-memory-contract.md`](../../plans/batch3-tool-memory-contract.md).

## Delivered

- Versioned descriptor/call/grant/observation contracts, progressive discovery and
  bounded read-only HTTP projections. Application-derived run authority; descriptor
  discovery cannot mint a grant. Existing frozen catalogs remain byte-identical.
- One opt-in gateway over existing composition and legacy Broker reads, with exact
  schema/implementation pins, pre/post-I/O scope/generation/lease/revoke/cancel
  fences and downstream context/publication checks. Unsupported opted-in effects
  fail closed rather than escaping through legacy execution.
- Additive migration053 and shared model/tool reservation accounting, including
  historical carry and unknown liabilities. Local time/CPU is not dollar billing.
  Atomic reservations and receipt-only late settlement do not authorize resend,
  refund uncertain money, disclose stale output or rewrite historical receipts.
- Restricted-PostgreSQL upgrade from actual accepted052 source preserves saved
  work, receipts and unknown model reservation under the pre-existing runtime role.
  A real loopback TCP admission → worker/gateway → event/checkpoint → API restart →
  revocation journey uses controlled synthetic adapters, not a paid model.

## Verified scope — not whole-suite claims

| Evidence | Result | Qualification |
|---|---|---|
| `capabilities-final-3.log` | 33 passed, exit0 | Retained completed gateway checkpoint, four test modules; no production changes in continuation. Original argv is not embedded in that log; collection-only confirmation is distinguished in `verification-index.json`. |
| `domain/retrieval/json/products/receipts.log` | 15 selected cases passed, exit0 | Exactly three selected cases per file; the retrieval three are address parametrizations, **not full SSRF coverage**. `commands.json` names exact nodes. |
| `summary.log` | 3 failed, exit1 | Original failure preserved, not rewritten. |
| `summary-baseline.log` | Same 3 failed, exit1 | Exact accepted26e599b archive, isolated source and newly provisioned disposable DB. Command, archive hash and source hashes in `summary-baseline-command.json`. |
| `residual.log`, `residual.xml` | 13 passed, exit0 | Four aggregate-accounting/privacy probes; two stale-existing-receipt replay probes; four redirect-denial cases; one subprocess deadline/environment case; JSON hash and revoked-continuation denials. |
| `contracts-generate/check.log` | exit0 / exit0 | Retained generation, canonical schema and TypeScript drift/type checks. |
| `correction-review.md/json` | PASS, no blocking findings | One narrow independent correction rereview; exact inspected bytes pinned. Original review/disposition preserved in `independent-review.md`. Added residual tests are author-authored after review; production bytes unchanged. |

The original broad `regressions*.log` runs are **incomplete/timeouts**, never passing
suites. They and earlier reds remain in `.local/batch3/b30a`; hashes, sizes and
recorded exits (null where no receipt exists) are retained in
`historical-log-inventory.json`. No blanket regression-green claim is made.

## Inherited summary failures — qualified, not hidden

The two known-usage cases compare the exact strings `0.0075` and `0.00750`.
The accepted aggregate query calculates the same exact monetary amount with a
different trailing-zero representation than its old per-event Python oracle.
The third case's `AccountingOnly` spy intercepts only `SELECT e.kind`; the accepted
implementation has already switched to one aggregate row, so that spy collects
nothing. Neither behavior was introduced by B3.0a (actual source comparison and
baseline execution retained). The wire field is a string without a fixed-scale
contract; no float conversion, cost loss or unknown-liability refund occurs.

Original tests and assertions are unchanged. New probes assert both literal
representations and their exact Decimal equality, unchanged non-cost fields,
unknown cost remaining null, billing remaining unknown, and the actual SQL
transfer containing only one strictly allowlisted scalar aggregate row plus the
shared carry row. This closes the relevant privacy/accounting question without
changing unrelated historical formatting or pretending those three old tests pass.

## Successor and operational boundaries

- Existing **t_04c80dd1 (B3.0b)** is the sole successor. Completion releases its
  dependency; this card neither starts B3.0b implementation nor creates a new graph.
- B3.0b consumes the canonical contract and existing event/checkpoint authority.
  Reserve the next migration after053; do not duplicate original-attachment storage.
- No file transforms, memory, connectors, UI lane or new execution profiles are
  claimed here. Current gateway adapters are the explicitly installed bounded
  reads listed in the canonical contract; category contracts are not capabilities.
- No paid product calls, private-account access, installed-data maintenance,
  production/default-branch release, runtime replacement or web edits. Independent
  development-agent review is outside the product ledger; its provider bill is not
  measured or represented as zero. Existing cumulative authority is unchanged.
- Disposable databases and original evidence are retained, not destructively
  cleaned. No private environment files or raw run contexts are staged.
- `source-sha256.json`, `frozen-catalogs.json`, `journey.json` and the review manifest
  bind the delivered source and evidence. Final staging/process checks are recorded
  separately in `final-checks.json`.
