# WorkAgent — authoritative implementation status

## 2026-10-18 — attended integration resumed

**Private alpha; experience NOT ACCEPTED.** The general persistent agent mission
remains: natural conversation, agent-chosen presentation, reusable real tools,
continuity, authoritative human corrections and authorized initiative. Memory and
learning remain sequenced through issue #10. A green suite is not acceptance.

### Ownership

- Attended Hermes integration owner: session
  `local-c415d94c0cb1a28dbdc8d80ccb863d223e5f8fe05b4279b71ed5895f40b9e6ca`,
  sole writer of `/home/ubuntu/workagent-build-mode`.
- Previous build owner `20261017_050237_0e042084`: gateway reports idle, no pending
  admissions, all four tracked tool jobs exited, no subagents or control loop.
  Historical failed dispatcher admissions remain UNKNOWN with terminal compute;
  none were reset or replayed. No unattended integration successor is claimed.
- Claude remains sole frontend owner. `d4e0290494d656bcfbc3a2d85b5a24d976e29f9d`
  is integrated. Coordination continues in PR #9, including the usable held-work
  exit and dependent-result staleness; no frontend implementation takeover.
- One isolated backend lane is implementing scoped saved-work discovery and
  retained background context on `hermes/context-recovery`. Its work is not yet
  in the published combination at this checkpoint.

### Published, not yet running

`7032da5f922306f806c25510bd8006043c7bff7e` on
`hermes/build-mode-continuity` / PR #16 combines:

- `e51de1704803dbbcfec7396c7ef71260d7eaee7f`: standing Home admission and bounded
  conversation context; the former local branch is now published.
- `5f70a730e2efae7e46fbb436ca242a10ebaf57c0`: sustained multi-action preparation
  and receipt-staged responsibility planning; former local branch now published.
- Claude's `d4e0290`, not merely `43bf5e6`.

Fresh combined checks on frozen `7032da5`: generated Python contracts match;
310 frontend unit tests, TypeScript, lint and webpack production build passed.
An initial frontend run had eight import failures because the isolated candidate
lacked contract dependencies; corrected environment, no source/test relaxation.
Serial real-PostgreSQL lease/status checks completed on disposable
`workagent_test_integration_20261018`: **44 passed, 6 failed**. One failure asserted
access with a deliberately retired worker capability; five depended on complete
multi-phase work fitting one wall-clock visit under host load. Corrections retain
all send-count, unknown-outcome and stale-fence assertions and drive only provably
settled synthetic leases. The historical 39-pass/11-failure run remains retained.
Targeted corrected checks are next; no green combined backend claim yet.

### Running product and authority

The loopback development services still run old application
`41a373965fd6aed6fdd6d55599a265515017cd9e`; they do not acquire newly pushed code.
Fresh heartbeat is unauthorized because the route/pricing verification dated
2026-10-16T16:39:55Z has expired. Exact failure:
`fresh_verified_general_route_and_pricing_required`. Installed grant consumer
pins still match that old process. Same approved model metadata GET and official
pricing were freshly verified on October 18; no generation was made by that check.

Installed grant remains `workagent-alpha-recovery-20261016-01`. Fresh shared
ledger: 108 count sends, 104 generations, 541 reads, no cancels, $17.14960 reserved
including $3.42992 carry, two unknown usage steps. Current project envelope is
$18.60072. Historical reservations are not provider billing and are not refunded.
Cumulative authorization remains $50, previously allocated $43.086, unallocated
$6.914. A compatible standing/sustained successor is being prepared within that
ceiling; no new installed allowance is claimed at this checkpoint.

### Next executable work

Finish targeted failure triage, integrate/review scoped discovery and background
context, freeze the final source, install compatible authority with readback,
restart from that candidate and exercise the ordinary product through correction,
revision/acceptance, interruption, later continuation and beyond eight turns.
Record loaded startup/build identity, real useful-progress latency and actual
sanitized desktop/phone evidence. Preserve held unknown work and human edits.
Authenticated review remains through the existing SSH loopback tunnel documented
in `docs/REVIEW_ACCESS_20261016.md`; user-device access is still unverified.
No default merge, production deployment, new paid route or broader private access.
