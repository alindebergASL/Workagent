# Workagent S0/S1 — usable local milestone handoff

## Outcome
A person can use the existing frontend to start private work from permitted synthetic
sources, inspect a plan and reusable checklist, save a human edit, compare a stale
proposal without losing either body, keep the human version, inspect history/sources
and reopen the same saved work after API/web restart.

**Real:** browser UI, FastAPI/domain services, PostgreSQL, authorization, revisions,
outbox/fencing, task readback, approved-bundle loading and activation/rollback.
**Fixture:** deterministic analysis and revision computation. No live model/runtime
or general-purpose agent quality claim is made. This is a usable completed local
portion, **not full S0/S1 qualification**.

## Open / run
- [Integrated draft PR #3](https://github.com/alindebergASL/Workagent/pull/3)
- Branch: `hermes/s0-s1-build`; app code reviewed/tested at
  `d937957521e1acdcffcac5d3ba3e70609f6cff98`.
- Subsequent handoff commits contain documentation/evidence only; application paths
  are verified identical to that candidate. Default branch has not been merged.
- Frontend branch/PR #2 at `26bac774a253115a4fc5f10b2e57d40ea46c58b1` is preserved
  and included; no second frontend implementation session was launched.

From the checked-out branch, on the documented local PostgreSQL/Node/Python host:

```sh
python3 scripts/workagent.py demo
python3 scripts/workagent.py serve
```

The first command installs/builds, provisions new disposable local storage only when
needed, runs the actual browser/API/PostgreSQL journey and restart proof, then runs
fault checks in a separate DB. The second runs the API, web app and continuous fixture
dispatcher. Open `http://127.0.0.1:3000` on that machine. Credentials are generated
locally and never shipped; this is not a public deployment. Root [README](../../README.md)
has prerequisites, test commands and restart/migration caveats.

## Inspect the result without running anything
- [Human-saved working plan](evidence/samples/human-saved-plan.md)
- [Reusable checklist](evidence/samples/checklist.md)
- [Desktop stale-proposal comparison](evidence/04-stale-proposal-desktop.png)
- [Mobile comparison](evidence/05-stale-proposal-mobile.png)
- [Sources](evidence/09-supporting-sources.png)
- [Saved artifact bytes and hash](evidence/saved-artifact.json)
- [Separate task readback](evidence/task-readback.json)
- [Persisted runtime/configuration/context observations](evidence/runtime-readback.json)

The canonical actor data yields **4/8 = 50%** missing an owner or next action, counting
the union once per case. The human's amended Wednesday protected block remains saved;
old-base proposal bytes remain inspectable. Time savings and causation remain unknown.

## Technical verification / independent review
- **46** Python backend/runtime/bundle/calculation tests passed, no skips.
- **10** frontend unit tests passed; typecheck, lint, formatting and production build passed.
- Complete OpenAPI export, generated TypeScript drift and contracts typecheck passed.
- **9** real browser/API/PostgreSQL fault cases passed. Actual successful responses are
  deliberately dropped for loss tests; success responses and persisted effects are not faked.
- Initial independent review found **six material issues**. All were fixed; independent
  focused recheck **PASS** at the exact code SHA, with all six closed, independently
  repeated gates and **five additional reviewer-authored browser cases** plus an HTTP/
  PostgreSQL drift/replay/revocation matrix.
- Coordinator independently compared the reviewer's executed source copy against all
  **182 tracked files** at the reviewed SHA: no mismatches.
- Main one-command demo/restart executed by the coordinator at clean exact code SHA;
  reviewer independently exercised fault cases, not the full root orchestration command.
- One existing non-failing Starlette/AnyIO deprecation warning remains.

[Acceptance by A01/A02/A03/A07/A16/A17](ACCEPTANCE.md) ·
[Initial findings and fixes](REVIEW_FIXES.md) ·
[Independent recheck](review/REPORT.md) ·
[Machine-readable verdict](review/recheck.json) ·
[22-file evidence manifest](evidence/MANIFEST.json)

## Runtime choice, usage and limits
The managed OpenAI Agents API remains the first live candidate; required account access,
project/model support and scoped grant are not established. No required managed contract
has been observed to fail, so no SDK/Responses contingency or Temporal layer was selected.
The local fixture dispatcher is the only executable adapter in this deliverable.

The saved canonical sample records **two fixture-completion units**. Live token usage and
cost are `not_observed`; development-agent cost is unmeasured, not falsely reported as zero.
No metered product-model calls were initiated. Coordinator session: `gpt-6-astra` through
`openai-codex`; delegated completion metadata did not expose model identifiers. Existing
CLI login/cache evidence is not product API entitlement. Details: [runtime status](../../docs/RUNTIME_STATUS.md).

**Still required before full qualification:**
1. Authorized product API/project secret reference, actual supported SDK/model access,
   permitted synthetic-data/retention posture and an explicit bounded spend grant.
2. Selected-runtime basic session/turn, interrupted stream, wait/resume, configuration
   change and actual compaction evidence; actual skill-enabled/disabled model comparison.
3. Andrew's judgment that the resulting work is useful. Technical review is not customer
   acceptance, merge authority, deployment permission or a provider-effect claim.

Local identity is a synthetic single-user bearer boundary, not production OAuth or SQL
client isolation. Historical source bytes after ingestion drift are explicitly unavailable;
current bytes are labeled separately from old observed dependencies. Artifact bodies use
transactional immutable PostgreSQL JSONB; no untested S3 protocol is claimed.

## Narrow next-S2 list — not started
After the first owner milestone and applicable live/identity approvals:
- Add the **second entry point**: private MCP/plugin client over the same domain services,
  not a second mutation implementation or independent agent retry owner.
- Complete the identity/auth spike with two explicit test identities and preserve workspace,
  source, actor and command scopes across the app and plugin.
- Verify app → plugin and plugin → app continuity over the same assignment/artifact IDs,
  including consistent denial and deliberate approval deep links; label those links clearly.
- Exercise actual-interface **A04/A05/A13** evidence before calling S2 complete.

Google staging/sharing belongs to the later contribution slice; it is not included here.
No synthetic recipients were contacted, no external invitations/calendar/sharing effects
were initiated, and no S2–S5 or production work was silently added.
