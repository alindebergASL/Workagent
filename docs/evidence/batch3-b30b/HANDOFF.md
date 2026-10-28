# B3.0b exact-source handoff — HOLD

**Current acceptance (2026-10-28):** [ACCEPTANCE.md](ACCEPTANCE.md) supersedes this historical HOLD. R3/R4 are corrected, integrated and independently reviewed; final source-bound build/browser/checks pass. `final-source-manifest.json` and `final-verification-manifest.json` bind accepted bytes and retain all negative qualifications. The sections below describe the earlier checkpoint, not the current blocker.

---

## Historical HOLD handoff (before authority correction)

Task `t_04c80dd1`; base `8d90e353e92a403eed521e9feea43b037997f307`;
branch `hermes/b2-conversational-client`. Candidate is **not accepted or committed**.
The existing successor `t_ae17ebd1` must remain dependency-gated.

## Blocker and required decision

One narrow independent Astra review completed successfully as an execution
(exit0), with **HOLD** findings. R1 privacy/count filtering and R2 durable native
rejection recovery received scoped PASS. Two new P1 web races remain:

- **R3:** after an ambiguous save, the textarea accepts newer human edits; exact
  replay success unconditionally clears the draft and replaces it with the older
  submitted bytes. `WorkspaceFiles.tsx:498–525,643`.
- **R4:** an old create completion after same-scope remount can clear a newer
  unresolved create journal and draft. This loses its exact replay identity and
  may allow a duplicate effect. `WorkspaceFiles.tsx:242–244`. The existing
  `usePendingCommand.clear(expected)` helper provides matching-envelope clearing,
  but draft and mount/operation ownership also need fencing.

The reviewer reproduced both with actual transpiled component handlers and
synthetic transport; parent independently inspected the cited production code.
See `final-narrow-review.md` for reproduction and reviewed hashes. These are
not fixed by the successful happy-path browser journeys.

**Needed:** permission for one additional bounded Claude correction of R3/R4,
or an explicit ownership/cap revision. Claude remains sole web writer, and the
one permitted correction prompt was consumed in the prior continuation. No new
writer was launched and Hermes did not modify web source. This is a specific
execution-cap/ownership boundary, not a general approval gate on development.

## Work completed in this continuation

- Verified all62 prior checkpoint hashes and all13 integrated web/lane hashes.
- Repaired opted-in file-schema request validation and persisted-ledger schema
  restoration. Added exact settled own-file attribution so a gateway-created
  file does not falsely invalidate the worker's frozen input. Untouched worker
  authorship/version/bytes are required; human edits still fence continuation.
- Added controlled GeneralWorker tests for normal settlement, restart after
  durable tool result, crash between gateway settlement and provider staging,
  and human edits preventing further transport/publication/recreation.
- Regenerated/check-verified canonical contracts. The four historical catalogs
  remain byte-identical to the base; intentional capability version2 is retained.
- Restarted an exact-current-source private API and reused the verified isolated
  optimized build. Main `.next` was untouched. Created fresh synthetic UI work.

## Actual verification

| Evidence | Result and qualification |
|---|---|
| `resume-final-core` | **123 passed / 1 failed**, exit1. Only failure was a new test's incorrect `ConversationDetail.work_version` accessor. Never relabeled as green. Production hashes unchanged throughout. |
| `resume-final-journeys` | **13 passed**, exit0 after correcting that test accessor; covers all final worker/DOCX journeys plus R1 restricted-PG two-member API and R2 definitive/ambiguous/restart regressions. |
| `resume-transport-gateway` | **163 passed**, exit0; Responses transport and capability gateway. |
| `resume-contracts` | Generate + check exit0; canonical web DTO bytes unchanged. |
| Retained corrected web checks | **36 tests**, typecheck and targeted lint exit0; exact web code unchanged. |
| Retained optimized build | exit0; build ID `5dDTlMcVhwU2lUumkB7Vz`. All186 tracked source/config/contracts inputs checked unchanged and predate completion; integrated main/lane bytes equal. No mechanical rebuild. |
| Current-source Chromium |1440/390/320 create/edit, four export formats across widths, verified downloads, reopen/reload, independent file/composer drafts: exit0. Separate actual-focus and unobscured-control hit tests at all widths: exit0. Viewport screenshots inspected. |
| Current-source real PTY |80x24 create/edit/export/download passed; initial restart harness raced rendering and exited1. Separate corrected reopen proof exit0 preserves file/composer draft and verifies download.120x40 full journey including process restart exit0. Negative captures retained. |
| PostgreSQL | Fresh disposable restricted role is neither superuser nor BYPASSRLS/owner. All56 migration checksums match source, including054/055/056. Installed databases/history untouched. |

These are bounded evidence groups, not an aggregate all-suite pass. Exact
sanitized argv/exits, source-before/current differences and negative receipts are
in `verification-manifest.json`. Current candidate has **63** intentional
source/contracts/test files in `source-manifest.json`; incidental inherited
`contracts/pnpm-lock.yaml` is excluded. Only the test accessor changed after the
final review; reviewed production hashes still match.

## Durable evidence and continuation

- `source-manifest.json`, `checkpoint-delta.json`, `verification-manifest.json`
- `complete-build-identity.json`, `resume-api-identity.json`, `resume-pg-identity.json`
- `final-narrow-review.md`, `review-binding.json`, `ui-evidence-index.json`
- Compact browser/viewport/PTY result JSONs beside this handoff.
- Full private local receipts, successful/negative screenshots and harnesses:
  `.local/batch3/b30b/`. Never commit env files, command journals or raw contexts.
- Contract guide: `docs/plans/batch3-file-evidence-contract.md`.

Recovered the complete original task from
`.local/batch3-dispatch/graph-manifest.json` and read retained lane/checkpoint
instructions. No preserved continuation of the truncated final-review sentence
was found; no additional scope was invented.

Owned API18772 and Next3199 are stopped and ports verified closed. Original
published/stale processes remain alive and untouched. No child writer/reviewer
or proof job remains active. Disk headroom8.0GB; no cleanup, product-provider
calls, installed-data maintenance, remote push or runtime promotion. Development
Astra review cost is unmeasured and outside the product ledger.

Resume **this same task** after the explicit correction-cap decision. Preserve
source/runtime/task graph; narrowly correct R3/R4 in web-owner, integrate only
allowlisted changes, rebind changed build/browser evidence, and resolve the
blocking review before completion. Do not release computation early.
