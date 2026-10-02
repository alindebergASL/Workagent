# Connected integration checkpoint (before runtime qualification)

Frontend preserved from `26bac774a253115a4fc5f10b2e57d40ea46c58b1`; integrated on `hermes/s0-s1-build`. No new frontend session or default-branch merge.

## Observed
`python3 scripts/workagent.py demo` completed on the actual production-built Next app, FastAPI and a newly provisioned PostgreSQL database:
- Create assignment with canonical actor sources SG-F2/F3/F7; ready plan/checklist, derived 4/8 union.
- Request a revision and hold worker completion. Human saves the canonical Wednesday protected-note amendment as revision 2 using the actual editor.
- Release old-base work: both bodies retained, attempted stale acceptance returns `version_conflict` even with a refreshed current ID; desktop/mobile comparison shows the distinction.
- Explicit keep-current resolution retains proposal history.
- Task creation receipt remains unresolved; independent matching readback verifies the persisted task.
- API and web processes are terminated and restarted without recreating PostgreSQL. Fresh browser sees identical assignment, current revision ID and body hash, with retained proposal hash.
- No browser page errors; 1440px desktop and 390px mobile screenshots generated, no horizontal page overflow.

Local evidence: `.local/evidence/{state,saved-artifact,stale-proposal,task-readback,restart,demo}.json` and eight screenshots. This checkpoint was tested with uncommitted integration changes; final exact-SHA review/evidence will follow. No live provider/skill behavior or owner usefulness acceptance is claimed.

## Adapter changes / rationale
- Generated client + canonical types with a presentation-only mapper. Exact backend errors retained; fresh authorized reads enrich conflict comparisons.
- Loopback-only server proxy keeps the random bearer out of browser JS; Host/origin/custom-header checks prevent cross-site and DNS-rebinding use of the local identity. Unavailable transport retains the ambiguous-write retry semantics.
- Canonical backend requires a nonempty completion criterion; the existing frontend sent an empty list. The current private-plan/checklist criterion is now explicit in the command and visible on Work Home.
- Preserve canonical `protected_note` block identity through human editing. Hold server-derived work version stable when retrying the same revision-request command; changed intent with same ID conflicts.
- Fixed duplicate drawer accessible names (History previously announced as Sources).
- Mock routes now fail closed unless explicitly running `/api/mock`; control endpoints additionally require an explicit control switch. Historical mock demo selects that mode explicitly.
- Shared-client import requires the repository as Turbopack root. Replaced dynamic fixture filesystem lookup with actor-only static import to avoid tracing unrelated private files.
- Existing pnpm lock contained three releases rejected by current release-age policy. Kept the policy enabled, pinned older permitted candidates and regenerated the web-local lockfile; no safety policy bypass.

## Commands
`python3 scripts/workagent.py demo` installs locked dependencies, builds, provisions only a NEW isolated DB when no environment exists, drives the real journey, restarts API/web and verifies retained work. Existing DBs are not reset. Requires local PostgreSQL 16, sudo provisioner access, uv, Node 22+, npm and pnpm.
`python3 scripts/workagent.py demo --skip-setup` repeats using installed dependencies/build.
The `serve` command will include the separately integrating dispatcher; it is not yet qualified at this checkpoint.

## Remaining
Source-body endpoint + checked-state schema alignment, approved-bundle durable activation and outbox dispatcher integration, exact integrated review/rechecks, final acceptance mapping and evidence publication. Managed-first live runtime selection still requires authorized product API/project access and a bounded spending grant. S0/S1 is not fully qualified.
