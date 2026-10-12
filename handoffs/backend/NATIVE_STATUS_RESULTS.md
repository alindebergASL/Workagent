# Native-continuation status correction — verified owner integration

## Scope and identity

- Claude owner commit: `edb09db466d3f636818b439c4e2102f9bb3d33f7`.
- Integrated, tested application: `5acc6e521766f3b830dea3f47b3c611056370be4`.
- Documentation-only closeout: `a0764115ecc24ef4ca3cf3832c483249c64a1ea6`.
- Original live continuation: `4186d337a5d3b225fc257dda02b9d18bb10ab63e`; its evidence at `ca2491b77f2a7e1ea447c47d5d2d8a6f57a39829` remains historical, not overwritten.

Claude delivered the correction through his existing branch after the local CLI invocation had failed OAuth. No authentication repair or competing frontend implementation was required. The integration changes only `TurnProgress.tsx`, `adaptive-presentation.ts` and the corresponding presentation tests. Backend, contracts, migrations and inference behavior are unchanged.

## Results

The P2's original behavior is corrected: actual stored steps with empty example checks say **No model examples were run for this step**, not **Model examples did not pass**. Explicit passed/failed states remain distinct; an unrun check alone does not produce a claimed recovery from failed validation. Historical aggregate-pass compatibility is covered by the tests.

Parent independently ran **173 frontend tests**, TypeScript, ESLint, Prettier and the production build: all passed. Integrated-head CI passed: [frontend](https://github.com/alindebergASL/Workagent/actions/runs/38296660560), [second frontend run](https://github.com/alindebergASL/Workagent/actions/runs/38296666015). CI names are recorded separately in the evidence receipt.

Bundle `gjVVx487evDkjOh6YV9Pn` was built with `NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1` and `/api/domain`. The executable native-target preflight passed against this bundle in a disposable database: exact target/full saved body/context binding, zero provider attempts, zero model responses or proposals. This is configuration proof, not another live generation.

The parent tested the actual saved conversation on desktop, 390px and 320px. Both real turns display the corrected unrun wording. The reply surface remains available; there is no pending Apply button or false goal-completion claim. Home → Conversations → work succeeds. Zero page errors, overflow or browser writes were observed. The same matrix passed after switching the existing loopback review location to the new bundle.

## Preserve later edits, not a frozen fixture

An initial read-only assertion expected the old accepted revision to remain current and stopped before browser interaction. Readback showed **two later human-authored revisions**; this was not a generation failure. No saved state was reset. The check was corrected to verify immutable accepted history plus preservation of the current human-edited revision.

- Historical accepted revision: `cd06942f-1a32-409a-b186-13900632970c`, hash `aae632c58fe85550e12acb53419254dece7c841d5d1fb4026792a2775f71a41a`.
- Current human revision: `6029f895-07ca-421c-96a6-9c77a69ddb32`, hash `d7f96469d17809cde87a470682f1e560fd40aa2d742cadd7c174d8307bd6487a`.
- The original protected human-context block is identical in accepted history and current work.
- Current revision, proposal records, conversation messages and model runs are unchanged across the read-only browser pass.

## Boundaries and separate verdicts

- **Engineering:** PASS for this bounded correction; parent checks and independent review passed. Original bounded continuation/persistence evidence is reused for unchanged runtime behavior. The independent reviewer found no P1/P2, ran 22 focused tests and 10 synthetic probes, and found no completion or authority regression.
- **Usefulness:** prior conditional-planning PASS retained, not upgraded to verified event readiness. Staffing/access decisions and partial/needs_validation run states remain explicit.
- **Experience:** bounded PASS; targeted P2 closed by owner correction, parent browser verification and independent PASS. Long-document scrolling remains a non-blocking usability limitation.

No model calls were made for this correction. Cumulative reservations remain **$5.93640/$20**, including **$3.42992 carry**; the count-only unknown is still open. The two-run allowance is exhausted and the consumer remains stopped. These are reservations, not billing. No default-branch merge or deployment; #13 remains open for broader requirements and Andrew's product judgment.

## Review

The updated app remains at **http://127.0.0.1:3166** (host loopback only, not public hosting), backed by the unchanged API on 8166. Existing SSH forwarding instructions still apply; no new exposure or credential is assumed.

Open Conversations → the volunteer-orientation conversation → its run sheet. Confirm the entrance reminder and later edits, inspect Saved history, then open **How this ran** in the conversation pane. On phone use Work / Conversation to switch. Both turns should now show **No model examples were run for this step**. Human editing remains available; additional model execution is not authorized.

The independent review is included in `evidence/native-status-13/independent-review.md`. The original OAuth-failure receipt and earlier PARTIAL/HOLD reports remain preserved as history, not current blockers.
