# Isolated runtime verification — 2026-11-04

## Result

**Controlled local runtime smoke PASS; complete integration verifier FAIL; full product acceptance not established.**

The running snapshot is commit `02f91b39878f2bdc2a9effa396022540968205d2`, not a default-branch deployment. All 4,785 archived files match that pinned commit after build. Recovery documentation edits do not change the running implementation.

- Next.js production build and TypeScript passed (webpack).
- Loopback-only web `http://127.0.0.1:3300` and API `http://127.0.0.1:8300` are running under an isolated supervisor.
- Fresh disposable database `workagent_test_3b142d43aee4`, 89 applied migrations. No existing database was modified.
- The worker uses the existing explicitly controlled no-inference profiles. This is a real web/API/database/Wasm interaction, not live model-selection or usefulness evidence.

## Executed checks

- Home and authenticated API/proxy reads: HTTP 200; missing scope/bearer: HTTP 401.
- Browser flow: Home message, controlled reply, synthetic CSV attachment/calculation, human note edit/save, recalculation proposal, explicit acceptance, and CSV download.
- Existing readback journey: intentionally lost acknowledgement, byte-identical retry without duplicate run admission, exact Wasm result `9007199254740993`.
- Actual API/web/dispatcher restart and fresh-browser readback preserved revision, run IDs, human note and pending proposal.
- Desktop and phone screenshots inspected. No page-wide horizontal overflow or page errors in focused smoke; table scrolling remains local. This is not comprehensive phone usability acceptance.
- Parent independently re-ran the authenticated HTTP/DB/source-identity health script and checked actual listener addresses/processes: PASS. Fresh fixture has 12 ready controlled runs, zero provider attempts, zero Responses steps, zero provider grants.

## Failure retained

The unmodified complete integration verifier failed at `web/scripts/products-journey.mjs:315`, expecting `.agent-pane [data-testid="peek-unlinked"]`. The observed UI instead provides target-aware replies and an unsaved-edit warning. Whether this is stale test expectation or an implementation regression is not resolved by the focused smoke; neither source nor assertions were changed to manufacture a pass. The original verifier did not reach its later outage/restart phases; the separately executed restart smoke is distinct evidence.

The first build also failed on missing isolated `contracts/node_modules/openapi-fetch`; installing the existing contracts lockfile dependencies in the snapshot resolved that setup failure. Both build logs are preserved.

## Durable evidence and lifecycle

Private evidence was copied out of scratch to canonical `.local/preserve/recovery-20261104/runtime-evidence/`: 32 files, SHA-256 manifest, complete report/commands, health and runtime JSON, browser outputs/screenshots, initial and restart results, and full-verifier failure log. No fixture credentials are published or included in that selected copy.

The runtime itself remains an ephemeral scratch preview under `.hermes/cache/scratch/workagent-recovery-02f91b3/`, not an installed development service. Its retained supervisor at handoff was PID `1095461`, process handle `proc_598292a250bb`. Verify the current PID/command before signaling; `USR1` restarts its children, `TERM` stops the stack while retaining the fixture/evidence. Do not treat a historical PID as permanent identity. The preview must be re-provisioned or moved to an explicit durable service before being relied on long term.

No model calls, new provider grants, business actions, public exposure, PR/default-branch merge, or production deployment occurred in this verification.
