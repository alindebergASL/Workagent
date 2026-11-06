# Independent correction rereview — HOLD

Reviewer: Astra (`gpt-6-astra`, OpenAI Codex), independent, read-only source review. Scope is the corrections to R1–R4 and their actual callers, not another broad review or browser acceptance gate.

**Candidate verified:** `/home/ubuntu/workagent-continuation-20261026`, HEAD `c75fb58ce07d8043b6ed58eba2ff6fd2b56af30d`, intentionally dirty source. Every file in `docs/evidence/batch2-recovery3/integration-manifest.json` matched its recorded `after` SHA-256, including the newly added `home-start.ts` and correction tests. Read the complete correction diff and current implementations/callers. `git diff --check -- web` returned successfully.

**Verdict: HOLD.** The upload-identity, basic staging-scope and blocked-restoration repairs are substantial and address the original direct reproductions. Two material caller-level gaps remain: checkpoint refresh failures still qualify as current, and Home's late-completion guard does not actually follow a switch to a workspace without a saved start.

## Remaining material findings

### RR1 — P2, R4 incomplete: failed checkpoint refresh is still passed as current

**Locations:** `web/src/app/conversations/[id]/page.tsx:362–368`; `web/src/lib/client/hooks.ts:73–83, 120–140`; `web/src/components/Batch2Controls.tsx:321–337`.

The new helper correctly rejects `checkpointsCurrent: false`, but the caller computes that flag as `!checkpoints.error && !checkpoints.loading`. That is not the resource's freshness contract. After an initial successful read, a transport failure retains cached data and sets **`reconnecting: true`**, without setting `error` (`hooks.ts:78–80`). `loading` remains false. Refresh also does not set `loading` true while a replacement read is pending.

**Source-level reproduction (not executed):**

1. Load a conversation and its current same-version snapshot naming run R; cache a continuable checkpoint C1 for R.
2. Refresh checkpoints and make that read fail with a transport error after the successful initial read. Keep the conversation/snapshot reads successful and compatible; no run is in flight.
3. The resource now has cached C1, `error === null`, `loading === false`, `reconnecting === true`.
4. Line 365 supplies `checkpointsCurrent: true`; `continueLatestRun` returns R; `ContinueRun` still offers a fresh command for C1. A newer checkpoint from that same run, if present, is not excluded by run-ID/version equality alone.

This contradicts the explicit failed-checkpoint/current-latest-checkpoint fence, even though the old-snapshot/newer-conversation example is now fixed. The pending-refresh interval has the analogous stale-cache exposure because `loading` is initial-load state, not refresh-in-progress state.

**Required correction:** derive eligibility from actual successful/current checkpoint evidence, at minimum treating `reconnecting` as not current and representing invalidation/in-progress freshness rather than assuming `loading` does so. Keep uncertain-command replay independent of fresh-command eligibility. Add a regression using the actual resource/caller state transitions; the pure-helper test at `web/test/b2-correction.test.ts:387–399` merely supplies the desired boolean itself.

This is a truthful-control/latest-checkpoint finding, not a backend authorization-bypass claim.

### RR2 — P2, Home scope binding incomplete: a switch to an empty workspace leaves the old start current

**Locations:** `web/src/components/Composer.tsx:185–209, 454–469, 490–497`; actual unkeyed mount `web/src/app/page.tsx:382–387`; alternative destination action `web/src/app/page.tsx:188–202`.

The durable writes now correctly use the captured start's workspace, and `clearHomeChat` checks the exact create command. However, `sameStart(chat.current, c)` is used as a proxy for “this start is still shown.” On a workspace change, the restore effect replaces `chat.current` **only if the destination has a saved Home chat**. It never clears the old value when the new workspace has no saved chat (nor when it has only an assignment). Therefore that proxy can remain true while a different workspace is selected.

**Source-level reproduction (not executed):**

1. Begin a document-bearing Home start in A; delay create/upload/send completion.
2. Change the Home destination to B, where there is no stored Home start. This is possible through a client-side URL/workspace change; the actual `home-destination-switch` alternative button also lacks the Composer's submission lock. Home mounts Composer without a workspace key.
3. B's restore effect finds no `c` and leaves `chat.current` pointing to A. The staged controller correctly opens B, but the chat ref does not follow it.
4. Resolve A's operation successfully. Its storage cleanup correctly targets A, but `sameStart(chat.current, c)` at line 461 is still true. It clears component files and navigates back into A's conversation despite the switch to B. On failure, the corresponding line-492 check likewise allows A's error/current-start update into B; subsequent B sends can become stuck on the “Return to the original Space” check.

**Required correction:** bind UI settlement to the actual selected workspace/mount epoch as well as start identity, and explicitly select/reset the current start when the destination changes even if there is nothing saved there. Keep origin-only durable cleanup. Add a Composer-level delayed-completion regression with **B having no pending record** (and ideally assignment-only B), not just a helper test that manually substitutes B's chat.

The test at `web/test/b2-correction.test.ts:538–568` explicitly performs `shown = b`. The actual effect does not do the equivalent for empty B, so that test cannot establish the claimed wiring guarantee. This finding does **not** allege uploads are redirected into B; the captured upload destination repair is sound on that path.

## Disposition of original R1–R4

- **R1, upload identity/destination: original direct defect addressed.** `StoredDocument.upload` retains command/request/workspace/conversation identity (`doc-store.ts:36–37, 58–73, 100–112`). New identities await persistence before dispatch (`documents.ts:250–277`), and ambiguous outcomes/lost receipt writes retain the original identity. Destination mismatch and legacy unknown/ref-only entries fail closed (`documents.ts:193–202`), with explicit reattachment/removal wiring. Home document starts use verified localStorage persistence before create, prepare/upload and send (`home-start.ts:62–83, 155–172`); `NotKept` preserves the in-memory command. See RR2 for the separate caller settlement defect.
- **R2, original late-file/read cross-scope write: addressed on the reviewed path.** `stagedController.add` captures/checks the epoch; upload callers capture an `Origin`; persistence/removal use that original scope rather than a mutable current scope. Serial writes/removes (`staged-documents.ts:71–79, 104–137`) prevent an already-enqueued delayed earlier put from finishing after a later deletion or receipt write. The added tests cover those specific orderings. This is not proof of all multi-mount or cross-tab concurrency.
- **R3, original blocked-restoration/drop and unavailable picker recovery: addressed on the reviewed path.** Read failure/corruption becomes explicit blocked state; add and send/queue readiness are gated; recovery buttons remain available even while picking is locked. A pending Home start with missing expected documents unlocks picking (`Composer.tsx:269–274, 597–604`); dispatch checks the expected hashes. Damaged records are not silently discarded. Actual browser interaction remains downstream.
- **R4: partially addressed, still HOLD under RR1.** Same-conversation/exact-version/non-stale snapshot checks remove the prior unconditional stale-snapshot preference and thread-run fallback. A legitimate canonical successor without a newer human message remains eligible. `ContinueRun` retains the existing uncertain body instead of inventing a fresh checkpoint command when fresh eligibility disappears. The actual checkpoint-resource freshness composition remains incorrect.

## Tests, type repair and nonblocking boundaries

- Read all new `b2-correction.test.ts` and `post-message-types.test.ts` tests and the changed upload tests. They cover useful helper/controller behavior, including unknown/reloaded uploads, lost receipt writes, failed initial durability, legacy reconciliation, late-scope updates, restore blocking and queued-write ordering. They do not mount Composer or exercise `useResource` freshness composition; the two remaining findings are precisely at those seams.
- Input repair remains structurally correct: `products.ts` uses `PostMessage-Input.operation`; `real-api.ts:1085,1094` uses the request-side schema; document refs no longer need the prior cast. Generated routes select `PostMessage-Input`. The revised type-test comment honestly states that current Input/Output schemas are structurally identical and the assertions prove endpoint compatibility, **not reference-name discrimination**. Runtime all-true checks alone are not a TypeScript gate; the parent owns the actual typecheck.
- Preserve the unaffected findings/limits in `.local/recovery3/review-first.md:56–64`: per-message document mapping and inert extraction rendering, proxy/download checks, work-stream boundaries, fixed local principal, and the nonblocking document-list pagination limitation. No broader re-review or changed conclusion on those areas.
- Browser IndexedDB persistence/restart, quota behavior, enabled recovery controls, narrow-screen UX and real delayed workspace switching remain downstream proof. They are not added acceptance gates for this bounded source/type/build card; the HOLD above is based on concrete source defects, not missing browser work.
- No tests, build, browser, services, paid product calls, credentials or implementation edits were run/made. Parent owns the serial full gates. One attempted read-only `execute_code` aggregation was blocked by unattended-mode policy and did not run; normal file/terminal reads supplied the evidence instead.

Only artifact written by this rereview: `.local/recovery3/review-reread.md`.
