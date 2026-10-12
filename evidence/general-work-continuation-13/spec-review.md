# First independent spec/usefulness review — exact dd01

**Verdict: PARTIAL; HOLD full slice acceptance and progression as a passing spec gate.**

Candidate: `dd01cd49a9b026edf8a99281d182e0554d54f4e2` (HEAD independently checked); baseline `9a009c6467369716a5e1d0c0d6f3b83337a2da8a`. This is the first spec review, not engineering approval or Andrew’s acceptance. No provider calls, messages, saves, proposal decisions, code changes, merges or deployments were made during review. Only this report was written.

The fresh initial document is useful and appropriately chosen. The follow-up contains a substantive, feasible revised schedule and clear decisions, but **does not adapt the editable canonical run sheet**: it creates a separate static custom view with temporary notes. Critically, the tested production build omitted natural admission, so the follow-up had neither an exact target nor the saved document body in model context. This invalidates a claim that the intended native targeted-continuation path was tested; it does not establish that a correctly configured product/model would fail that path.

## Evidence and actual choices

Reviewed `docs/plans/general-work-continuation.md` acceptance/stopping rules and `docs/BUILD_PLAN.md` M2/M3 boundaries; exact-candidate policy, admission/context/selection code, view source and trusted editor. Inspected retained primary/follow-up snapshots under `.local/general-continuation-execution-01/`, `note.saved.json`, model-selection result events and scoped selection-context fields. Independently opened the running production UI on port 3164 in isolated browser session `general-spec-dd01`, at 1440px desktop and 390px phone, then reopened the original document read-only. Also reviewed the subsequently supplied parent primary browser verification and independent child breadth report/readbacks; their expanded journey coverage is attributed below, not represented as this reviewer's own interaction.

- Conversation: `43ff87f2-7f31-4b38-be48-c811b9e10bcd`.
- Initial selected operation: `publish_artifact`, `target:null`, document. Saved initial revision `abe017b2-f42a-4f07-b0e7-90d21db6dc40` of `ae6b9019-9af6-4bb9-a0b1-a67234f7cffe`.
- Human revision: `d2154cf7-66e4-48f4-b3dc-0280d87b5c70`, hash `332a03075a8dc18b403fd69c18c326d498a8dd864201c70dd1ee403fc66d4aa6`. Exact reminder survives: “Human note: keep the entrance clear for wheelchair access; do not remove this reminder.” Programmatic comparison found only `human-notes` changed; the other blocks are unchanged. Line breaks within the human-notes block were removed during the operator save; do not claim exact original formatting preservation.
- Follow-up selected operation: `publish_artifact`, `target:null`, `custom_view`. New artifact `85a3c800-5e03-43da-8412-41e62210deab`, revision `16e7560c-6cf7-4f11-ad05-3fc456bed47b`, hash `01a78b75aa7189e87cd92c499cdc814b02d7521d6f07b8711a17037ea27227ec`.
- The view declares only `read_original` / `read_binding`, bound to the exact human revision/hash. Its script loads and renders original blocks; it neither changes that document nor recalculates the static revised schedule. Its sole working-notes textarea is explicitly temporary. Snapshot proposals filtered to this conversation: zero; original UI proposal cards: zero.
- Actual execution metadata and selection requests identify `gpt-6.1-sol`, `general-responses-v1`, live-provider receipts. Both runs are `partial` / adaptive `needs_validation`, with received selection/final responses, not unresolved provider generations. Shape-only validation is not usefulness verification. The separately reviewed controlled breadth replay is described below.

## Confirmed P2 findings

### P2-1 — Review-build configuration prevented the intended targeted continuation (harness/integration finding)

The actual persisted follow-up message has `target:null`. Its exact selection context has `target_body:null`; `bindable_artifacts` contains only original artifact/revision/hash/title metadata, not the saved body or accessibility-note text. The model could preserve/display the exact note through a generated read-binding view, but could not select an authorized revision of the original target.

Evidence chain:

- `web/src/lib/client/capabilities.ts:13–24` explicitly gates natural admission on `NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION=1`.
- `web/src/app/conversations/[id]/artifacts/[artifactId]/page.tsx:290–300` supplies the saved exact target only when that capability is enabled.
- Served chunks retain the environment comparison rather than a compiled enabled value; observed message/context confirms the disabled-path outcome.
- `backend/workagent/conversations.py:262–276` supplies the full saved revision only via the exact target; other bindable work is metadata only.
- `backend/workagent/general_responses.py:160–169` requires the model target to equal the admitted target. With no target, publishing creates new work rather than revising the document. Guessing a target would violate authority.
- `handoffs/backend/ADAPTIVE_PRODUCT_CHECKPOINT.md:9,14,69–71` already documents this build-time requirement and this precise omitted-target pitfall.

**Impact:** The paid run cannot pass or fail the intended exact-target adaptation behavior. Rebuilding later cannot retroactively repair its evidence. This is not evidence for weakening target guards or adding backend target inference.

### P2-2 — The observed continuation is an alternate explanation, not an editable continuation of the chosen work (confirmed outcome; product attribution bounded by P2-1)

The new schedule is durable as view source, but its working decisions are not durable and its original visitor log/checklists appear as read-only rendered text. The canonical editable run sheet still says Sam is available throughout, includes him in the original second slot and pack-up, and has no pending replacement. The generated phrase “This is a proposal” describes a suggestion, not an actionable canonical Proposal record.

The generated instruction to use shell save/proposal controls does not save the temporary textarea or install the revised schedule. `FlexibleWork.tsx:430–506` offers a custom view plus a fallback-text editor; document editing belongs to the original document branch. There is no bridge from this view’s textarea to that document. Original editing remains available via the shell link, but the user must manually reconcile the two products or ask again.

**Impact:** The exact observed execution fails the plan’s “adapt useful chosen work” continuity criterion (`general-work-continuation.md:23,25,57,74`). Calling it a full useful-work adaptation PASS would overstate the result. It does not justify a fixture-specific schedule operation, mandatory document-to-view sequence, or claim that the underlying save/proposal mechanism is broken. No confirmed P1 safety/authority/data-loss defect was found.

## Usefulness and temporal assessment

**Initial work: PASS, bounded.** A document with editable prose, checklist decisions, visitor log and organizer notes is proportionate to the request; no table or custom-view sequence was prescribed. Unknown job lengths, parts, shared tasks and six bookings versus completed repairs are handled explicitly. No contacts/bookings are claimed.

**Follow-up reasoning: PASS, bounded.** Independent arithmetic check gives 120 minutes for both timetables. The revised intervals are: briefing 10:00–10:15; two-repairer slot 10:15–10:45; handover 10:45–11:00; Jules-only slot 11:00–11:30; close-out 11:30–11:45; Jules/Lee pack-up 11:45–12:00. Sam has no assigned work after departure. Required briefing, two 30-minute slots and pack-up are protected. Nominal repair opportunities fall from four to three across the stated slots, explicitly conditional rather than a promise about all six visitors. Decisions cover triage fairness, long-job limits/safe stopping, Jules’s takeover approval, arrivals during briefing and two-person pack-up feasibility. Actual workload and pack-up adequacy remain human decisions, not proven operational safety.

**Human-note preservation/reopen: PASS, bounded.** The view visibly reported exact saved revision loaded; the original was displayed separately, not silently rewritten. Independently reopening the original on phone exposed the exact saved reminder in its enabled ordinary editor. This proves preservation/readability, not a new save test or line-break retention. The entire original is expanded below the new result, so reminder discovery takes substantial scrolling; this is not promoted to an additional blocking defect.

**Desktop/phone presentation: PARTIAL overall; read/reopen mechanics PASS within observed scope.** My direct inspection found the result and capacity caveat lead on desktop; phone shows the proposed decision and has no measured outer-page horizontal overflow at 390px. Trust wording says not verified and cannot change saved work. Useful durable controls remain in the original document, not the changed result. The subsequently reviewed `.local/general-continuation-browser/verification.json` additionally records desktop/phone/narrow-phone Home/reopen, exact bound note, unchanged saved document, visible steering, zero shell/frame overflow, six successful HTTP 200 broker reads, no writes/errors/provider calls, and temporary notes lost as labeled. This corroborates the persistence limitation rather than repairing it. No correctly targeted new steering submission or process-restart proof is claimed.

**Breadth: PASS, controlled REPLAY only.** Reviewed `/home/ubuntu/workagent-general-continuation-review/.local/general-continuation-breadth/{REPORT.md,verification.json,scope-and-cleanup.json}` after the child completed. Independently recomputed `137 * 12 * 75 // 100 = 1233` and compared the recorded Wasmtime observation, visible UI result and exact pending-proposal binding. Proposal `def1b33e-a617-44ce-a0ee-3b7c2529f7f9` remains pending with no accepted revision; human current revision `f9698612-d77a-4d35-b562-518d18807758` remains unchanged. Evidence records desktop/390px/320px controls, preserved note, Home/reopen and fresh-browser-context readback. Isolated DB readback reports zero provider attempts. Five synthetic conversations, nine runs and four proposals include retained harness retries, not five model attempts. The code is retained source, not new generation; valid-input breadth does not establish invalid-input behavior or generalized autonomy. Parent separately reports directly re-querying that isolated DB; this reviewer did not repeat that DB query.

**Broader agency: not demonstrated.** Neither the primary turn-to-turn response nor the controlled calculator replay proves autonomous M3 correction, M4 delegation or M5 ownership. Breadth/read-reopen passes do not remove the primary targeted-continuation evidence gap.

## Bounded next step

Keep this run and failed continuity evidence intact; keep #13 open. First correct/verify only the isolated review build configuration with natural admission explicitly enabled at build time, using provider-free request inspection on disposable test state to prove artifact-page steering carries the exact current revision/hash and saved body. Do not submit another primary live message merely to replace this outcome.

Then decide whether the slice is honestly published as PARTIAL/HOLD or whether a separately labeled, authorized follow-up test is warranted. Only an observed generic defect under the correct native configuration warrants the plan’s at-most-one targeted correction; no narrow fixture fix is supported by this evidence. Engineering review may assess an explicitly held candidate, but must not treat this report as a passing spec gate. No acceptance, merge or deployment is authorized by this review.
