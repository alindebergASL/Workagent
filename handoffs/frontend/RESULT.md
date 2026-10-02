# Frontend result

Status: ready for integration (mock mode). Not integrated with the real API; not reviewed by a second author yet.

Usable outcome: A solo user can start private work from selected sources, watch honest queued/working/partial/ready states, read a recommendation with its evidence and uncertainty, open the plan and checklist, edit the plan and save a revision, request an agent revision, review a stale proposal with both bodies and their revision IDs, keep the current version or save a deliberate resolution that re-checks the current revision, inspect sources and history without silently restoring, and reopen the same assignment after the app process restarts. Desktop (1440), mobile (390) and 320px are covered with keyboard-only conflict resolution and focus return on drawers.

Branch / commit / PR: `claude/workagent-frontend-kyg51x` (based on `hermes/s0-s1-backend` @ `3f1b17b`) / `092e0098359fbdd5a4f9384d7e86b15503ba9640` (implementation and evidence; this note is the following commit) / PR against `hermes/s0-s1-backend`, linked from issue #1.

Shared contract commit or hash; generated client version: **none available**. Provisional adapter `frontend-provisional-0.1` (`web/src/lib/contract/types.ts`, `web/src/lib/client/api.ts`), to be replaced by the `workagent/v1` generated client from `contracts/`, to be replaced by Hermes's generated client.

Owned paths and coordinated shared-file changes: see `handoffs/frontend/STATUS.md`.

Actual setup / launch / test commands (all executed in this session):

```bash
cd web
pnpm install
pnpm dev                                   # http://127.0.0.1:3000, mock mode
pnpm check                                 # tsc, eslint, prettier, vitest (8 tests)
pnpm build && PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm test:e2e
PLAYWRIGHT_CHROMIUM_PATH=... pnpm demo:s1  # build → journey (3 viewports) → confirmed stop → restart → reopen → report.json
```

| Check | Mode: mock / real app / live runtime | Result: pass / fail / not observed | Evidence |
|---|---|---|---|
| Start and inspect result | mock | pass | `evidence/{desktop,mobile,narrow}/01–05`; `journey.spec.ts` asserts queued/working then "Ready for review", recommendation "4 of 8 cases (50%)", three saved results, sources drawer with focus return |
| Start and inspect result | real app / live runtime | not observed | no service or contract on the remote |
| Human edit and save | mock | pass | `07-artifact-editing`, `08-artifact-saved`; server readback: revision 2 by a human author, protected Wednesday note unchanged, draft preserved until acknowledgement |
| Stale proposal and resolution | mock | pass | `09-artifact-conflict` (both bodies, base/current/proposal IDs, accepted pointer unchanged, proposal body retained); keyboard-only "Keep current version"; `11–13` deliberate resolution with an intervening save returning to review with the draft intact, final revision 5 keeps the human text |
| Restart and reopen | mock (app process only) | pass | `15–16`, `report.json`: process stopped with health endpoint confirmed down, new process started, same assignment/artifact/revision IDs and human text reopened. Mock state file, not PostgreSQL; the real restart with retained volumes is Hermes's |
| Restart and reopen | real app | not observed | — |
| Desktop/mobile/keyboard | mock | pass | all screenshots exist at 1440/390/320; no horizontal page scroll asserted on home, assignment, artifact and conflict; Escape closes drawers and returns focus; Enter on the default action resolves the conflict |
| Sources/history/error states | mock | pass | `05`, `10` (declined proposal in history, old revision viewable without restore), `17-home-start-error` (request and selection kept; retry replays the same command; exactly one assignment created), `18-assignment-reconnecting` (stale data kept, same assignment resumed, no new run), indistinguishable not-found/not-authorized in API and UI, command_conflict on changed payload |

Unit tests (vitest): intake union count generic over rows, protected note carried verbatim, CAS/version_conflict with both bodies, command replay/conflict, historical reads never move the accepted pointer.

Independent review, findings, fixes and rechecks: Self-review of the actual browser output found and fixed (1) source-marker chips overlapping wrapped text, (2) 29px horizontal overflow at 320px from a non-wrapping button, fieldset min-width and chip labels, (3) full-page captures pinning the sticky action bar mid-page, (4) the demo runner failing to stop the Next server's forked child, which would have invalidated restart evidence (now signals the process group and refuses to proceed unless the health endpoint goes down, and refuses to start if the port is already answering). Also fixed after rebasing onto Hermes's bootstrap: the formatter had rewritten the frontend's fixture copy, breaking its byte-identity; the copy is removed and the mock now reads Hermes's canonical `fixtures/actor` file. Independent review by a second author is still pending; Hermes to coordinate.

Screenshots and saved-result locations: `handoffs/frontend/evidence/<desktop|mobile|narrow>/NN-*.png`, `handoffs/frontend/evidence/journey-ids.json` (assignment, artifact, revision and proposal IDs from the run), `handoffs/frontend/evidence/report.json` (machine-readable pass/fail/not_observed), `server-1.log`/`server-2.log` (secret-free).

Known gaps / blocked dependency / exact requested action:
- No real API: everything above is mock-mode application behavior; nothing certifies server authorization, CAS, durability or runtime behavior.
- Needed from Hermes: contract version/hash, generated client and mock locations and generation command, service start command, test identity (see STATUS.md).
- Not built (out of S1 frontend scope): team administration, Google OAuth/Picker, ChatGPT plugin, provider routing, billing. "Respond" for `needs_input` is rendered but has no backend operation to call yet.
- Draft backup is per-tab `sessionStorage` keyed by base revision, cleared on acknowledgement or lost access; it is not persistence.
- Mock controls (`/api/mock/_control/*`) are test hooks; disable with `WORKAGENT_MOCK_CONTROL=0`. They are not part of the product contract.
- Evidence PNGs are ~19 MB in Git; happy to move them to CI artifacts only if preferred.

Next integration step for Hermes: publish the contract baseline and client; point `NEXT_PUBLIC_WORKAGENT_API_BASE` at the service; run `web/e2e/journey.spec.ts` against it (the `_control` calls become the real worker/fixture adapter hooks or are replaced by waiting on real state); then extend `demo:s1` to restart API/worker with retained volumes.

Resumption checkpoint if interrupted: branch `claude/workagent-frontend-kyg51x`, this file and `STATUS.md`; `cd web && pnpm install && pnpm demo:s1` reproduces all evidence from a clean checkout.
