# Workagent #13 — verified integrated candidate

## Verdict and exact identity

**Engineering candidate PASS.** Exact integrated application SHA:
`d6de6b728a5641f2d7f31c68250b8695c3edbfbf`, published on
`hermes/flexible-work-13`. This includes Claude's frontend `cd49ec0` and Hermes's
acceptance-check fix and named-binding policy guidance. The application worktree
was clean and frozen through the final gates.

This report and `evidence/flexible-work-13-final/` are on a separate evidence-only
child branch, `hermes/flexible-work-13-evidence`. That branch is **not substituted
for the tested application SHA**. No backend/frontend/contracts/migrations differ
between the tested candidate and its evidence-only child.

Issue #13 remains open for product/experience acceptance. No default merge,
non-default integration PR merge, production deployment or new paid route occurred.
The review PR is stacked on `hermes/adaptive-product-integration` (PR #12);
PR #9 remains frontend-owner coordination. Hermes was the sole backend writer;
Claude remained the frontend owner.

## Implemented

- Additive self-describing structured tables with stable typed field/row identities,
  units, nullable values and edit rules; historical invoice tables keep their meaning.
- Durable bounded generated HTML/CSS/JS source, readable fallback, revision history,
  human saves, model proposals and explicit acceptance on the existing substrate.
- Exact-view-revision/hash/access-generation and same-conversation scoped read broker;
  closed empty payloads cannot name arbitrary targets, save or approve.
- Opaque-origin no-network browser host; trusted shell owns draft status and failures.
- Generated canonical OpenAPI and TypeScript handoff consumed by actual renderers,
  with mobile cards, CSV export, Home discovery, typed edits and proposal review.
- Human-check mismatch fixed without changing historical migrations or weakening SQL:
  an incompatible shape-only draft is rejected before verification and can continue
  to executable work or terminate cleanly at the existing step limit.
- Notes preserve sequentially typed spaces/newlines through navigation, reload and
  save. Version-pinned generated source no longer gets a misleading rebind button.

## Exact-candidate executed gates

- **771 backend tests passed** on fresh PostgreSQL, one dependency deprecation warning.
- **164 frontend tests passed**, plus TypeScript, lint and formatting.
- Production-domain and isolated mock-mode builds passed.
- Canonical contract export, generated TypeScript drift and contract typecheck passed.
- **26 fixture-transport browser DOM regressions** passed.
- **9 real-Chromium sandbox regressions** passed.
- **15 mock browser tests** passed across desktop, mobile and narrow layouts.
- Fresh PostgreSQL + real API + production web + continuous controlled consumer:
  create → edit → save → reopen → propose → human accept; all three processes then
  stopped/restarted and reopened the same saved work. Raw note keyboard/edit recovery,
  invalid values, scoped reads, stale binding, malformed/undeclared actions, hostile
  frame probes, explicit rebind and Home/phone behavior passed.
- **7 production-UI checks** on the retained actual live-model artifacts passed:
  table/accepted human edit, actual saved CSV download, generated interactive filtering
  and scoped refresh, trusted-shell malformed-target refusal, phone/fallback, second
  calculator goal reopen, and Home discovery. No provider calls or saved mutations.
- Original production-app typing repro now returns exactly `Hello world`, then
  `Hello world\n`, then `Hello world\nSecond note`; local draft discarded.
- Independent incremental review **PASS** at this exact SHA. Its separate real-browser
  fixture probe confirmed raw notes survive browser reload before canonical save.
  Prior backend/broker review scope was reused, not replaced with an unbounded audit.

Logs, readbacks, reviewer scope, CSV and screenshots are in
[the final evidence manifest](../../evidence/flexible-work-13-final/manifest.json).
The manifest hashes every packaged file and binds the candidate SHA/tree. Credentials,
environments, DSNs, provider transport payloads and private stack logs are excluded.

## Live-model usefulness, separately bounded

The original live route was `gpt-6.1-sol`; generation occurred at runtime `fffb69b3`,
not newly during this final integration. Ordinary natural-language turns with no
operator-selected operation produced two meaningfully different outputs:

1. A reusable rainwater WASM calculator: independent re-execution passed **107 integer
   oracle cases** and **four invalid-domain rejections**.
2. A four-venue structured comparison and useful custom explorer: exact supplied
   synthetic facts were retained. A human raised Willow Hall's price to £350 and
   added the exact Marta note. The model proposed a corrected no-qualifying-venue
   assessment and concrete discount/alternative next steps without changing facts.

The human edit survived API/consumer interruption after provider identity persistence.
Recovery reused that identity without another generation dispatch; the proposal stayed
pending until explicit human acceptance, then reopened with all identities/note intact.
The view reads saved data through the broker: £300/70/step-free gives no match; £350
shows Willow Hall and River Centre; dropping accessibility at £300 admits Station Loft.
The final product UI consumes these actual retained artifacts, not only fixture copies.

All product-generated work remains honestly partial/needs-validation. Operator checks
of these cases do not grant universal verification or promote draft status in the app.

## Budget and preserved state

Final read-only reconciliation: **eight live dispatches**, **$4.48528 cumulative
reserved liability / $20**, including **$3.42992 historical carry**, zero unknown
current-slice usage steps. Reservations are not billed cost and were not refunded
or replaced with lower usage estimates. No additional generation occurred during
integration, final QA or review. Historical saved review databases/services remain
preserved; ephemeral test-stack processes were stopped by their owning harnesses.

## Remaining engineering/usefulness/experience gaps

- Literal-source pin detection is a conservative usability heuristic, not semantic
  code analysis or authority. It may miss encoded pins or flag incidental literals.
  Backend exact-version/access checks remain the security boundary.
- Policy now tells future source to use named binding/body rather than embed IDs and
  hashes. **No fresh generation proves compliance with that prompt change.** Existing
  pinned source is preserved and honestly requires an updated view after data changes.
- Local filters recompute correctly, but saved per-row draft assessments still describe
  the original £300 criteria. They can look contradictory at £350; they are not
  automatically recomputed recommendations. Phone cards/notes are verbose.
- The browser proof is Chromium, not every engine; browser isolation is not a hard
  CPU quota. Custom actions in this slice are reads only, not general writes.
- Andrew's product/usefulness/experience acceptance is not claimed. Broader durable
  responsibility/specialist coordination, memory/learning #10 and portability #11
  remain separate sequenced work.

## Next steps

1. Review the integrated candidate's actual table/editor and venue explorer on desktop
   and phone, using the retained screenshots/artifacts and the host-local production
   review at `http://127.0.0.1:3161` when accessible. Confirm the bounded experience
   and whether the static-assessment/version-pinning limitations are acceptable for
   this slice. These are disclosed limits, not hidden green-test claims.
2. Decide merge/release separately. The new review PR is stacked on PR #12; preserve
   the dependency order and recheck exact heads/CI before any authorized merge. Do
   not merge or deploy merely because this report says engineering PASS.
3. After acceptance, close #13 with this evidence and select the next scoped product
   milestone. Prefer one useful end-to-end capability over a universal renderer
   framework; keep #10/#11 and broader ownership work explicit rather than silently
   treating them as delivered by generated views.
