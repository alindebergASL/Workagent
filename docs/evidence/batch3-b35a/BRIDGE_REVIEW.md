# Narrow parent assessment — frontend memory-source formatter

This is a separate parent review by gpt-6-astra/openai-codex of the later CI-repair delta, not a new independent-review campaign and not covered by the earlier `REVIEW_FINAL.md` or independent reports.

## Inspected change and risk

The production diff adds only the `source_type === "memory"` branch to `sourceRefText` in `web/src/lib/memory-contract.ts`. It returns the exact memory ID, revision ID and hash. The generated union already contains this kind. The branch fixes the TypeScript narrowing failure and avoids rendering external-source fields as undefined for a memory reference. Existing file and external-source branches are unchanged.

The sole production consumer is `MemoryPanel.tsx`'s provenance list under “Why this is here”: `<li key={i}>{sourceRefText(ref)}</li>`. It is a React text child, not an HTML injection sink, navigation, lookup or command. The formatter performs no I/O, mutates no data, and cannot widen recall authority. It enumerates only reference fields; extra payload content is not interpolated. The original backend eligibility and erasure fences remain unchanged and retain their accepted evidence.

## Actual proportionate verification

- Actual repository runner: `node node_modules/vitest/vitest.mjs run test/memory-source-ref.test.ts test/memory-commands.test.ts test/memory-reads.test.ts test/memory-procedure.test.ts`: 63 passed, no failures/skips. The first focused run passed 1 test; the expanded run contains 3 bridge tests and the existing 60 memory checks, not additive campaigns.
- New tests assert exact memory identity, unchanged file/external-source formatting, and the same React text-child render sink escaping markup while omitting extra source payloads and undefined fields. This is focused render verification, **not** a mounted MemoryPanel or browser journey.
- Current TypeScript, focused formatting and ESLint checks pass. Commands, outputs and source hashes are retained in `results/bridge-verification.json` and associated logs.
- The consumed older browser source differs in this formatter only among web runtime source inputs; MemoryPanel itself is identical. Full input differences, including generated contracts, are disclosed in `CLIENT_BUILD_BINDING.json`.

Verdict: no blocking issue found in the narrow bridge. No authorization, state, request/replay, layout or component wiring change requires reopening the broad safety campaign. Earlier browser correct/forget/revoke/readback proofs are reused only for their unchanged paths; they do not establish rendering of the new memory-reference kind. The old optimized build is explicitly not exact-current. Final exact-head frontend CI must pass before this card completes; it supplies current optimized builds and the repository browser suite, not a new live-backend safety campaign.

Historical failed CI40895284299/40895268881 remains failed. No paid product calls, dependency installation, shared symlink-target writes, service revival, unknown replay or installed-data maintenance was needed. Build publication is not deployment.
