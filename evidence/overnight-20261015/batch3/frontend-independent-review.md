# Independent focused frontend review — batch3

**Candidate:** `088691cb9a7d184f769f4bac4f4db13f9fb8c0c1`, application `4d262889961484187c4ab229b6f7aa222344f0ea`, owner through `078fddd`. Current `web` tree equals `078fddd:web`: `c1a56079d50b255dab9a8011f7a0a79a9a7a8e0c`.

**Verdict: HOLD for complete in-place terminal-denial suppression; one actionable P2.** The new **conversation-card refusal overlay passes** the frozen and additional generation/recovery controls. The in-place consumer sends canonical requests and preserves the existing sandbox, but its separate Space loader still masks a late explicit denial behind a faster transient failure, leaving the denied interactive view visible and Send enabled. No backend authorization bypass is demonstrated.

Reuse batch2 independent/final reviews for unchanged scope; no backend/product source was changed or re-audited. Reviewed actual source delta `a719f28..088691c`, preserved in `reviewed-delta.patch`. Product-source working-tree diff was empty before and after these checks. No owner takeover, provider/product inference, spend, original-service requests, DB changes, installs, or dependency mutations. All test listeners used ephemeral loopback ports and were closed; all browser processes were joined/closed in harness `finally` blocks.

## R1 — P2: Space's aggregate read can keep the denied running view

**Locations:**
- `web/src/components/SpaceView.tsx:65–80`: nested `Promise.all` work loader.
- `web/src/lib/client/hooks.ts:58–81`: the first transient rejection retains last-good data as reconnecting.
- `web/src/components/SpaceView.tsx:104–115, 273–288, 353–361`: denial/selection and sending gates depend on the aggregate error, which never sees the later refusal.
- New consumer `web/src/components/SpaceView.tsx:604–618` / `FlexibleWork.tsx:733–761`: that retained work now mounts a running `InPlaceView` rather than only readable fallback.

**Exact reproduction (four Chromium variants):**
1. Open a project with selected custom view A, bound to table B. Wait for its three supplier rows and canonical revision label inside the actual iframe.
2. Click **Refresh this project**. Return an immediate transport-like rejection from A's proposals read. Return a real `ApiError(code='unauthenticated', status=401)` or `ApiError(code='not_found_or_not_authorized', status=404)` from A's artifact read after 100 ms.
3. Wait until the denial has actually been delivered, then inspect after another 150 ms.
4. Repeat with B's proposals read being the faster transport failure instead of A's.

**Observed in all four cases:** `denialDelivered: true`, `iframeCount: 1`, supplier rows and `Reading saved version b-r1` remain inside the frame. The project says merely “Showing the work as last read; can’t re-check it right now,” while the view's trusted binding line still says “current saved version.” Filling an unsent draft leaves **Send enabled** (`sendEnabled: true`). No Send was clicked.

The explicit refusal is lost after the first rejection of the shared promise. The new `useResultStates` refusal overlay is not used by this loader. This is **cached client content/interaction retention**, not evidence of a fresh unauthorized backend read or successfully submitted unauthorized command.

**Provenance control:** `controls-report.json` executes predecessor `a719f28` SpaceView/ConversationPeek with the same controlled race. Its readable fallback also remains after denial. Therefore the aggregate defect predates this delta; the new in-place consumer expands the retained surface to an active sandbox with previously read data. Do not describe this as an overlay regression, or reopen the now-passing card finding.

**Owner fix direction:** carry explicit refusal precedence into Space's own per-work read path, including both artifact and proposals reads. A known refusal must promptly unmount the affected selected view, discard retained content, preserve the person's draft/choice, and hold sending, regardless of a faster sibling error or a sibling that never settles. Retain last-good data only for genuinely transient items; recover only after a subsequent complete authorized read. An intentional fail-closed aggregate policy is also possible, but must not discard a known denial behind another error. Keep the existing overlay implementation and its passing controls intact.

**Acceptance:** both 401/404, both request orders and both same-/other-artifact sibling failures; denial while a sibling remains pending; isolated refusals; transport-only retention with uncertainty; later successful recovery; preserved unsent draft and sending held when selected work is denied.

Evidence: `inplace-report.json` (four failing cases), `inplace-output.txt`, `denied-view-retained.png` (visually inspected), `controls-report.json`.

## R2 — P3, nonblocking: pinned views get impossible update guidance

`web/src/components/FlexibleWork.tsx:1147–1155` checks `inPlace` before `pinned`. A view whose source names its exact bound revision, after that input changes, says **“Open the view to point it at the latest saved versions.”** On its own page, the existing `pinned` branch instead explains that it **cannot simply be pointed at the new version** and asks for an updated view.

`controls-probe.cjs` loads an exact-version-bearing source and changes the table revision; `controls-report.json` records the in-place update guidance and absence of the pinned explanation. Preserve the pinned explanation before the in-place branch, or use neutral guidance that does not promise rebinding. This wording problem does not authorize a stale read or save.

## Verified bounded PASS

### Refusal overlay / stale generation handling

- Frozen retained suite: **17/17 pass**, `stalled-report.json`, `retention-output.txt`.
- Additional overlay controls: **6/6 pass**, `overlay-report.json`, `overlay-output.txt`.
- Checks include immediate per-work refusal with pending siblings, later recovery followed by transient failure (no sticky refusal), obsolete-generation denial after a new successful key, obsolete success after a new denial (no cached resurrection), workspace-scoped refusal identity, and recovery withheld until its successful aggregate is published.
- No exception or page error in these cases. This closes the earlier card-only races within the exercised cases; it does not cover Space's separate loader.

### Sandbox and canonical frontend request boundary

- Existing hostile-content browser regressions rerun against current source: **9/9 pass**, `sandbox-output.txt`.
- Focused current-source unit suites (`sandbox`, `flexible`, `space-view`, `result-links`): **48/48 tests across 4 files pass**, `unit-output.txt`.
- New consumer explicitly sends the saved view's `view_revision_id`, `view_body_hash`, and `access_generation`, route workspace and view artifact ID; the iframe receives empty bootstrap data and only the declared action map.
- Nonempty forged payload attempting to supply another workspace/artifact/revision/generation is rejected **before any broker method call**, and the host refusal notice appears. Undeclared and prototype action names also never reach that method.
- Opaque `allow-scripts` sandbox remains in force. Hostile suite exercises no network/storage/parent DOM/top navigation, no forms/popups/downloads, request rate/size limits, and self-navigation stopping with readable fallback.
- A deliberately late **successful** old action result after replacement of the view revision cannot populate the replacement frame (`lateSuccessDelivered: true`, replacement still contains only “New canonical view”).
- After an input revision changes, the trusted shell marks the binding changed and offers no inline rebind/save button. A controlled broker refusal produces a generic frame error; the view's old local computation remains visibly marked stale by the shell. **Ordinary version change is not a test of immediate clearing of formerly authorized data.**

**Boundary:** browser APIs are controlled mocks, not a new backend authz certification. The mock's canonical-refusal behavior is a test stimulus; the frontend envelope/rejection/rendering assertions are the observed result. Unchanged service authorization remains covered by prior review, not invented from this harness.

### Keyboard and mobile content after actual resize

Bounded actual-React/component experience **PASS**, not broad full-application/device acceptance:
- Owner-authored supplier comparison HTML/CSS/JS was extracted inertly from `space_demo_fixture.py`; actual SpaceView, FlexibleWork, SandboxedView, hooks and current CSS execute in Chromium.
- Desktop → **320px**: wait for actual iframe rows and revision text; focus slider and press **Home/End**; verify ranking changes from Lark & Co to Quayside Press and label becomes `100% price, 0% speed`.
- Switch Work → Conversation, type an unsaved draft, switch back; real iframe rows and slider value persist, with no extra broker call from local ranking/pane switching.
- Page scroll width/viewport both **320**; iframe scroll width/viewport both **289**. This is not merely an empty-frame overflow check.
- Resize back to desktop: actual content, slider value and draft remain. Reads/Used by buttons are keyboard-activatable and select the linked work in place.
- `mobile-320-content.png` and `desktop-restored-content.png` were loaded and visually inspected: comparison rows, revision label and working slider are present, without evident clipping or overlap. `mobile-320-frame.png` preserves the isolated frame capture.

**Limit:** controlled actual-React surface, not full Next shell/real-service E2E, real mobile hardware, screen-reader certification, or natural-model usefulness. The previous blank full-app screenshot is not erased; this supplies independent content-after-resize evidence at component scope.

## Evidence and rerun commands

All artifacts are under `.local/overnight-batch3/frontend-review/`.

From repository root:

```sh
node .local/overnight-batch3/frontend-review/retention-probe.cjs
node .local/overnight-batch3/frontend-review/overlay-probe.cjs
node .local/overnight-batch3/frontend-review/inplace-probe.cjs
node .local/overnight-batch3/frontend-review/controls-probe.cjs
node .local/overnight-batch3/frontend-review/sandbox-regressions.mjs
node .local/overnight-batch1/frontend-v2/web/node_modules/vitest/vitest.mjs run \
  --config .local/overnight-batch3/frontend-review/vitest.config.mts
```

`inplace-probe.cjs` intentionally exits **1** for the four R1 failures: **13 cases = 9 pass / 4 fail**. The remaining commands completed successfully. `verification.json` programmatically counts all browser reports and records exact source hashes and empty product diff. `bundle.cjs`, `fixture-runtime.js`, `owner-fixture.json`, and `prepare-harness.py` preserve the harness inputs and generation approach; product source was never patched.

Initial harness issues are retained, not product findings: missing nonmutating dependency resolution for unit tests (`unit-output-initial-resolution.txt`) and an omitted HTTP charset causing mojibake/string assertion failure (`inplace-output-initial-charset.txt`, matching JSON). Fixed only private harness/config, reran, and captured final correctly encoded screenshots. No product build or full backend suite was run.
