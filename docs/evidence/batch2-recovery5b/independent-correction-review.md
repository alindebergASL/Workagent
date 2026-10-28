# Independent correction review — PASS (scoped increment only)

Reviewer: independent Astra / openai-codex subagent. Scope: exactly the nine entries in `final-scoped-delta.json`; six production files and three new tests. No product/API/DB writes, provider calls, service changes or implementation edits were performed by this reviewer.

## Source identity

- Independently parsed both manifests: predecessor 599 entries, current 602 entries. Their complete difference is exactly the declared nine-file delta, including matching before/after hashes.
- Located predecessor copies of all six production files under `.local/recovery3/claude/`; verified each against its predecessor SHA-256 before generating and reviewing the actual unified diffs. The broader dirty Git working tree was not mistaken for this increment.
- Independently hashed all 602 current manifest files twice, including immediately before this report: zero missing or mismatched files.
- Current manifest SHA-256 is `1a969241aa7dfba5f77cf7382f2c521cb1d5fd12bb1ce831e230968fba89017f`. The build ID and all three lint/format/build log hashes match `source-and-gates.json`.

## Findings

No blocking security, data-loss, replay-identity, STOP-authority or document-wrapping regression found in this delta.

- **Exact new text, unchanged frozen replay:** `web/src/lib/client/conversation-reply.ts:255–335` changes only new Send/Queue payload text from trimming to the original string. Blank validation remains at lines 219–234. Existing `cmd.current` / `queueCmd.current` envelopes bypass construction, so already-pending commands are not normalized, regenerated or assigned new identities. Exact-generation cleanup is unchanged. `web/src/components/Composer.tsx:392–398,454–460` likewise preserves new Home message text while retaining the trimmed title. The unchanged `runHomeStart` helper constructs a send only when `c.send` is absent; frozen pending sends remain intact.
- **STOP is an offer, not new authority:** `web/src/lib/batch2-view.ts:84–120` adds the unavailable-turn case only with a non-stale snapshot matching conversation, work version and exact run ID, and an explicit active-state allowlist. Existing queued/responding behavior is preserved. The page passes the same run and version to the unchanged explicit-confirmation `StopRun` command (`web/src/app/conversations/[id]/page.tsx:533–550`). Backend ownership, conversation-version CAS and queued/running checks remain unchanged. This does not authorize Continue, accept proposals, cancel queued messages or close the conversation.
- **Wrapping rather than hiding:** `web/src/styles/agent-first.css:1109–1121` and `web/src/components/Batch2Controls.tsx:570–628` use `min-width: 0`, `pre-wrap` and `overflow-wrap: anywhere`, without clipping, ellipsis or height limits. Extracted text still renders as inert JSX text. Inspected the saved 320px document, queue/STOP, editor and review screenshots, including full-resolution crops. The long XLSX formula is wrapped rather than horizontally cut off.

## Verification actually performed

Executed:

```text
./node_modules/.bin/vitest run test/exact-message-text.test.ts test/document-overflow.test.ts test/stop-offered.test.ts test/batch2-durable.test.ts test/batch2-controls.test.ts --no-cache
5 test files passed; 36 tests passed; exit 0.
```

Also independently parsed the final JUnit report: 481 tests, zero failures/errors. This full-suite result and the successful webpack/TypeScript build are retained parent execution evidence, not a full-suite/build rerun by this reviewer.

Reviewed `browser-journeys.mjs` assertions and retained reports. `controls-final/controls.json` records the exact whitespace/Unicode queue intent, an actual STOP POST followed by canonical cancelled-state readback, an open conversation, a separately retained then cancelled queued message, and an actual attention/seen POST. Comparing recorded before/after runs shows only the targeted queued run changes state; historical runs retain their states. Pending proposals remain present after attention acknowledgement. Baseline evidence covers expanded PDF/DOCX/XLSX text at 1440/390/320, original-download hashes, and preserved human notes after a browser cell edit. Review evidence records explicit replacement consent and preservation of notes/cells; it does not claim objective completion.

## Acceptance limits / non-blocking follow-up

1. This is **not full Batch2 acceptance**, an all-43-row matrix sign-off, or proof of paid/longitudinal model operation. Earlier integration reviews remain applicable only to source shown unchanged by the manifest comparison.
2. At review cutoff, `upload-final/stage.json` and `unknown.json` pass, but `upload-final/replay.json` is not yet present. The earlier `upload-rerun` pass must not be represented as the final-source post-API-restart replay. Parent must retain the new replay/readback and restart/source binding before making that stronger claim.
3. The new Home/hook exact-text tests partly inspect source syntax; they are not mounted component lifecycle tests. Real browser evidence directly proves Queue text preservation. Do not call that a dedicated whitespace-sensitive Home Send plus ambiguous-message-ACK replay proof. Such a mounted/browser regression would strengthen coverage but is not required to accept these small, directly inspected payload changes.
4. Page-level scroll-width checks and the saved Chromium screenshots support the reported widths and fixture. Full-page captures contain fixed composer/navigation overlays, so they are not proof that every control is simultaneously unobscured, nor physical-device keyboard/zoom or universal accessibility acceptance.

Only this review evidence file was created by the reviewer. An initial `execute_code` read attempt was blocked by unattended-session policy; ordinary read and terminal tools completed the review without bypassing that restriction.
