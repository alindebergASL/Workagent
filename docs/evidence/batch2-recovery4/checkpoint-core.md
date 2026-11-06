# Recovery4 checkpoint — integrated core PASS, remaining gates running

Task `t_77ca6df4`, branch `hermes/b2-conversational-client`, unchanged HEAD `c75fb58ce07d8043b6ed58eba2ff6fd2b56af30d` plus intentional uncommitted integration. No production/test/web/schema changes on this card.

Source frozen in `candidate-manifest.json` (1,528 candidate files) and `test-source-manifest.json` (599 backend/contracts/web/fixture files, including intended untracked files). Source is byte-identical to predecessor recovery3; backend/contracts are also byte-identical to recovery2. Existing independent review conclusions/limitations reused in `review-reuse.json`; no new changed seam requiring another review.

Fresh disposable restricted PostgreSQL created via canonical `backend/dev_db.py`, private credentials only at `.local/recovery4/test.env`. Runtime is neither superuser nor BYPASSRLS. All49 migration checksums match source; identity/schema fingerprints in `database-proof.json`. Each test seeds its own synthetic workspace. Actual HTTP and process-restart tests use current-source ephemeral loopback servers, never stale API18963.

**Core result:**34 selected files, **411 passed, zero failures/errors/skips**, exit0,1512.01984932099seconds. JUnit `backend-core.xml`; log `backend-core.log`; exact argv and source-before/after equality in `results.json`. Includes full operator/TUI/document/event/checkpoint/lease/process-restart campaign. This is not the entire backend suite or real browser/PTY acceptance.

Active serial runner `.local/recovery4/run_verification.py`, tracked process `proc_510c5111e892` (shell PID3684486), now running30 shared-runtime regression files. On success it proceeds to canonical contracts, TypeScript, full frontend tests, lint, format, webpack production build and diff check. It stops on any failure; logs are exclusive-create, not overwritten. Whitelisted environment excludes provider credentials; no product provider worker or paid run is started.

Do not edit source while runner is active; it checks the whole frozen candidate before/after each gate. No other implementation writer was found. No dependency installation, shared symlink mutation, database maintenance/cleanup, commit/push, merge or deployment. Disk most recently13.79GiB free. Preserve all prior red evidence.

Existing successor `t_5f6349b3` (terminal/API continuity journeys) was inspected: it depends on this card and remains todo. Browser/shared-work/A01–A35/P1–P8, paid trajectory authority checks and publication belong to the existing downstream chain. Batch2 remains incomplete.
