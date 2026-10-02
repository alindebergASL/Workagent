# Backend / integration status

## Candidate and ownership
- Coordinator/backend/integration owner: Hermes; branch `hermes/s0-s1-build`.
- Tested application code: `d937957521e1acdcffcac5d3ba3e70609f6cff98`; subsequent evidence/docs commits do not imply new application behavior.
- Draft integrated PR: https://github.com/alindebergASL/Workagent/pull/3
- Existing Claude Code frontend branch `claude/workagent-frontend-kyg51x` at `26bac774a253115a4fc5f10b2e57d40ea46c58b1` is preserved and integrated. Frontend PR #2 remains open; no merge/closure authority inferred. No duplicate frontend implementation session launched.
- Frontend acknowledged the shared layout through issue #1. Hermes subsequently owned integration adapter/proxy and targeted review fixes in the integrated branch; root scripts/lock coordination is explicit.
- GitHub chose the first bootstrap branch `hermes/s0-s1-backend` as default in the previously empty repository. Default remains bootstrap `3f1b17b`; no default-branch merge or public application deployment performed.
- Andrew explicitly permitted public repository visibility after kickoff. Full original packet, credentials, private envs and process logs remain outside published materials. Committed examples/evidence are synthetic only.

## Usable contract
`workagent/v1`: canonical schemas/domain services in `backend/`, PostgreSQL migrations,
OpenAPI 3.1 and generated TypeScript client/tool registry/examples in `contracts/`.
Stateful fixture mode runs the same services/schemas against real PostgreSQL.

- OpenAPI SHA-256: `4170548e5bd4b415342e799108d1014ed677d6cd06b437fffe9d1b103aa4845e`
- Model registry SHA-256: `2adb7311d13fdc420278f48b35b8432a107046cfce9ed77c21c882fe5a559aa2`
- Exact domain errors retained, including `not_found_or_not_authorized`, `version_conflict`, `command_conflict`.
- Compatible additions since first checkpoint: authorized SourceDetail content and checklist-only `checked`. Client/mock schemas regenerated. Source-drift handling now distinguishes current access, new-mutation freshness and committed replay.

## Connected behavior
Production-built existing UI -> real API -> PostgreSQL creates assignments, produces
fixture-derived plan/checklist, shows sources/unknowns, saves human edits and checked
state, preserves both bodies for stale proposals, resolves explicitly and reopens the
same persisted revision after terminating/restarting API and web.

Durable outbox/fenced dispatcher, scoped broker and pinned approved context are integrated.
Bundle version 0.1.1 activation/rollback preserves existing 0.1.0 inputs and current access.
The local `serve` command automatically advances work; demo controls stage release for
conflict evaluation. No live model/runtime execution is implied.

## Verification and review
- 46 Python tests, no skips; 10 frontend tests; contract drift/types and production build passed.
- Nine actual-browser/API/PostgreSQL fault cases passed. Main demo and API/web restart passed at clean exact code SHA above.
- `handoffs/backend/evidence/MANIFEST.json` pins 22 selected synthetic evidence files, including desktop/mobile/source screenshots, saved bodies, task readback and run/context pins.
- Initial independent review found two P1 and four P2 issues. All six have implemented fixes and targeted regression evidence (`REVIEW_FIXES.md`). Focused independent recheck is pending; do not treat this note as final reviewer approval.
- `ACCEPTANCE.md` separates fixture/application evidence from missing live-runtime and owner-usefulness acceptance.

## Start / generation
- Full demonstration: `python3 scripts/workagent.py demo`
- Local use: `python3 scripts/workagent.py serve` at `http://127.0.0.1:3000`
- Generation: `npm --prefix contracts run generate && npm --prefix contracts run check`
- Root README documents prerequisites, separate test DBs, exact operating mode and safe restart.

## Runtime / spending boundary
Selected executable local adapter: deterministic fixture v1. Live runtime selection
remains managed-first and pending product project/API entitlement plus bounded grant.
No fallback is justified by missing access alone. No metered product-provider calls
were initiated. Recorded sample usage is two fixture-completion units; live tokens/cost
are not observed, and development-agent cost is unmeasured rather than claimed zero.
Coordinator session identifies `gpt-6-astra` / `openai-codex`; delegated completion metadata
did not expose model identifiers. Installed Codex/Claude CLI access is not product entitlement.

Next action: resolve independent recheck, then publish final local-mode milestone handoff.
S2–S5 remains outside this build.
