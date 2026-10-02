# Responses integrated review fixes — backend handoff

Scope: **IR-S1, IR-S2, IR-L1, IR-L3** on `hermes/intake-next-action`, based on
`c0e41960bb2a0d8361d4180e6f51c3f4d7dad1e7`. IR-L2/frontend remains owned by its
frontend implementer; this patch supplies its deterministic semantic-ID contract.

## Implemented boundaries

- **IR-S1:** `Ledger.retain` rejects every kind except `count_result`, `identity`,
  and `result` **before a transaction is opened**. `count_send`, `dispatch`,
  `read`, `cancel`, and `tool_result` must use their existing current-capability
  paths. Genuine late evidence and historical boolean ACK remain independent of
  current continuation authority. No SQL trigger or migration was weakened.
- **IR-S2:** Frozen construction binding backs read-only `provenance`,
  `project_id`, and `credential_reference`. Both worker authorization and grant
  attestation call `matches_binding`: exact concrete transport, construction mode,
  client origin, exact underlying HTTPX transport class, and (official mode)
  project/reference/header binding. The synthetic factory remains synthetic;
  public relabel attempts raise `AttributeError`. Even an instrumented official
  constructor returning MockTransport cannot attest official execution. Normal
  official construction still requires opt-in, credential, project and reference.
  This protects the supported public interface, **not** a Python sandbox or an
  adversary that rewrites private implementation/code.
- **IR-L3:** A create 2xx with missing/invalid response ID raises a sanitized
  `TransportError(outcome_unknown=True)` before terminal persistence. The worker's
  existing controlled unknown path marks the attempt unknown immediately,
  retains the full reservation, emits no identity/result without identity, and
  never resends after restart. Both selection and final phases are covered.
- **IR-L1:** The DTO's title becomes the proposed title on revisions rather than
  being discarded. Policy honors requested title/replacement, distinguishes the
  current group from preserved history, and retains human constraints. Human
  approval still applies the exact proposal against the exact base revision.

## Stable semantic-ID contract (also the IR-L2 handoff)

`to_body` emits these paragraphs FIRST, in this exact order, with `attempt_id`
appended literally to each prefix:

| Position | Exact prefix | Text role |
| --- | --- | --- |
| 0 | `managed.current.` | Says the current proposal supersedes prior agent advice; revision requires human approval |
| 1 | `managed.next-action.` | `Next action (proposed): ` plus current `next_action` |
| 2 | `managed.missing-information.` | `Missing information: ` plus newline-joined items |
| 3 | `managed.source-basis.` | `Source basis: ` plus newline-joined `source_id@external_version: basis` |
| 4 | `managed.specific-judgment.` | `Specific judgment: ` plus current judgment |
| 5 | `managed.scope.` | Fixed task-not-performed statement |

For a **revision only**, position 6 is `managed.history.` + `attempt_id`. Its
text explicitly states **prior saved content retained for context; earlier agent
recommendations superseded**. EVERY existing base block follows it in its
original order with identical fields, IDs, kind, text and whitespace. Earlier
managed IDs are not rewritten, relabeled, removed or treated as the current
recommendation. Select the first/current group, not the last matching semantic
prefix anywhere in the document. Initial bodies have no history separator.

The returned DTO title is inspectable as the proposal title. The previous saved
title and entire base body remain in immutable revision history; current saved
work is unchanged until human approval. General `Body` and `NextAction` wire DTO
fields/schema are unchanged. This is a deterministic representation contract,
not a claim that synthetic text proves real-model instruction compliance.

## Test-first evidence

New maintained regressions: `backend/tests/test_responses_review_fixes.py`.
Existing prefix-preservation assertions in `test_responses_worker.py` and the
executable `responses_journey.py` now assert the exact current group, explicit
supersession and exact historical suffix instead of silently weakening retention.

Before implementation, the new test module produced **38 failed, 10 passed**:
unauthorized receipt kinds reached the transaction, public labels were mutable,
construction validation was absent, 2xx invalid identities reported an internal
error, and managed current/title semantics were absent. After implementation:

- Focused new regressions + existing worker/transport suites: **204 passed**.
- Entire backend and runtime suite: **307 passed**, no skips; one existing
  Starlette/AnyIO deprecation warning.
- Original review probe file was **not modified**. Its non-characterization
  safety/restart/concurrency tests: **15 passed, 8 deselected**, including late
  evidence across authority loss and historical ACK after source revocation.
- Original vulnerability characterizations: **7 failed, 16 deselected**, at the
  intended now-fixed assertions: four forbidden retention kinds, public
  provenance mutation, dropped rename, and expected SQL error. This is evidence
  of changed behavior, not a passing safety suite; maintained intended-state
  assertions supply the positive regression gate. The scratch frontend-payload
  export test was deliberately excluded to avoid overwriting the parent's probe.
- Executable synthetic journey: initial + revision + exact human approval and
  restart `reconciled`; outcome/safety gates passed. Counts: 4 count sends,
  4 generation dispatches, 4 reads, 0 cancels; reservation USD `0.52768`; billed
  cost remains null. All transport traffic in this journey is HTTPX simulation.
- Contracts genuinely regenerated through `generate`, including
  `contracts/src/schema.d.ts`; Python JSON drift, generated TypeScript drift and
  TypeScript compile checks passed. Generated files are byte-identical to the
  baseline because no wire fields/schema changed.
- `compileall` and `git diff --check` passed.

Local evidence logs under `/home/ubuntu/.hermes/cache/scratch/`:
`responses-review-fixes-red.log`, `responses-review-fixes-green.log`,
`responses-review-fixes-full.log`, `responses-review-fixes-original-safety.log`,
`responses-review-fixes-original-characterizations.log`.

Reproduction from the repo root (source only the disposable test-DB environment):

```bash
set -a; source .local/intake-checkpoint-v3.env; set +a
PYTHONPATH=backend:. backend/.venv/bin/python -m pytest backend/tests runtime/tests -q --tb=short
(cd contracts && npm run generate && npm run check)
PYTHONPATH=backend:. backend/.venv/bin/python -m compileall -q backend/workagent backend/tests runtime
git diff --check
```

## Scope and remaining gates

**Actual product/provider/account calls: 0. Product credential reads: 0.**
No frontend, authority record, old migration or historical fixture was edited.
Only the affected worker runbook was updated. No push, deployment or default-
branch merge is authorized. The initial contract command was attempted from a
root without a package manifest, then corrected to `contracts/`; regeneration
and drift checks succeeded there. Its incidental untracked pnpm lockfile was
removed; no dependency manifest/lockfile change is part of this patch.

The parent must independently recheck the final commit, integrate/review IR-L2,
and own browser/live acceptance. Consumer and instruction pins change with these
fixes: any eventual official grant must be pinned to the reviewed final consumer
and instructions before use. Existing supplied access does not itself approve
this new implementation or constitute live execution evidence.
