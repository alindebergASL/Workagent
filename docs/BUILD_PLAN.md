# S0/S1 implementation and evidence plan

1. Canonical typed Python domain services and PostgreSQL transaction/migration baseline;
   exported OpenAPI 3.1; generated TypeScript client; stateful frontend scenario service;
   real authorization, replay/CAS tests; early informational contract checkpoint.
2. Connect existing frontend owner's UI to creation, ready artifact and human save.
   Hermes owns integration, not a parallel frontend implementation.
3. Integrate approved pinned bundle and fenced deterministic worker; preserve independent
   source/work/artifact revisions, stable commands, separate task readback, audit/outbox.
4. Demonstrate stale proposal review preserving both bodies, deliberate resolution and
   same assignment/revisions after process restart with PostgreSQL retained.
5. Independently review exact integrated candidate for specification/security/recovery,
   then quality/UX/content; reproduce and fix material findings with focused rechecks.
6. Deliver one-command browser/API/PostgreSQL demo and sample artifacts; acceptance
   statuses report fixture/app/live separately. Owner usefulness and blocked live tests
   remain explicit, not converted to PASS.

No default-branch merge, production deployment, paid product runtime, Google side effects
or S2–S5 work is authorized by this implementation plan. Public repository visibility was
explicitly permitted after kickoff. Full originals remain outside application/runtime.

## Body-storage decision
Prefer transactional immutable PostgreSQL JSONB for this small private-work slice.
No S3 distributed-transaction claim or new object-storage dependency. If the implemented
baseline chooses this, DB immutability must be tested and accepted-byte hashes retained.
A future object-store adapter needs its own staged/hash/commit/orphan reconciliation tests.

## Coordination
See handoffs/backend/STATUS.md and GitHub issue #1. Backend/contracts are implemented in
an isolated bounded development child; root/runtime/bundles/fixture import stay with
Hermes. Child work receives controller verification and independent integrated review.
