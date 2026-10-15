# Overnight batch3 — safer in-place work, visible mobile controls, bounded evaluation runner

## Delivered, not claimed

Application `afab13babd54a14ed3da5404677265b74b11ce73` integrates the sole frontend
owner through `133e857`, including `1810fea`. Hermes did not edit `web/` or take over
that ownership. Backend runtime/contracts/migrations remain byte-identical to the
reviewed batch2 runtime; the only new backend repository edit is a test-fixture fix.
No default-branch merge, public deployment, account expansion or Hermes installation
change occurred. Original `92e76d8` checkout/data/build/six admissions remain intact.

Engineering: bounded improvement verified, with a final independent successor-helper
review still required before activation. Usefulness: more trustworthy work interaction,
not fresh model usefulness evidence. Experience: actual desktop,390px and320px screens
viewed, and interactive controls exercised after resize; not a polished-product or
physical-device acceptance verdict.

## Product changes and actual checks

Independent review found a remaining Space loader race: a faster transport failure
could mask a later401/404 and leave selected content, including a running interactive
view, visible. This was an inherited loader defect expanded by the new view consumer,
not a server authorization bypass. No send was performed in its reproduction.
The finding was routed to existing owner on#9, comment6186762851, with exact readback.
Claude's `133e857` gives per-work terminal refusal precedence independently of failing
or indefinitely pending same/other sibling reads. Selection identity and draft remain;
content is suppressed and sending held. Only a fresh successful complete read recovers.
It also restores regeneration guidance before the in-place rebind guidance for
exact-version-pinned views. Earlier raw failures/reviews are preserved.

Parent results on the integrated owner bytes:

- Frozen actual-React in-place probes:13/13; retained preview cases:17/17; refusal-overlay
  lifecycle/scope cases:6/6. Additional pinned-guidance probe passes.
-265 frontend tests; type/lint/format pass. Production webpack build passes. The default
  Turbopack build rejected the external dependency symlink; that failure is retained,
  and webpack is identified explicitly, not called a default-build pass.
- Real Next/API/PostgreSQL Chromium journeys:7 routing cases and18 Space cases pass.
  This includes actual human-note edit/save/reload; scope, keyboard and draft holds;
  immediate401/404 suppression despite faster failure or indefinitely pending siblings;
  real frame content and keyboard weighting after resize to390 and320; no writes from
  the weighting control; source-change invalidation and navigation/reload.
- Parent viewed all three published supplier screenshots. Unlike batch2's blank320px
  capture, the slider, ranked suppliers and saved-version status visibly render.
  Mobile screenshots are scrolled to the view, not full-device acceptance.

The event-planning and supplier-investigation content is authored controlled fixture
content. A real sandbox/action broker and canonical binding are exercised, but these
screens do NOT prove natural model choice/adaptation of representations. Desktop still
has a narrow conversation column; repeated provenance/read links and visible version
IDs remain experience limitations. No polish creep or fresh frontend takeover was added.

## Backend validation and the one full-suite failure

A source-frozen backend run completed:1223 passed,1 failed, no errors/skips. It started
at`aedc130`; backend code/tests and canonical runtime status stayed unchanged throughout.
The failure was`test_untrusted_journal_path_refused[mode]`: the test used
`mkdir(mode=0o755)` under the runner's restrictive umask077, which produced a SAFE0700
directory. It then incorrectly expected the journal to reject that safe directory.
The same exact pre-fix test fails under077 and passes under022; both traces retained.

`afab13b` changes only the deliberate-unsafe fixture to chmod0755 explicitly and assert
that mode. All22 operator replay tests now pass under both077 and022. The runtime
security check is unchanged. Do not combine these into a claim that a new full suite
ran green: the final full-suite rerun remains open. Historical failure evidence remains.

## Real bounded successor implementation, still inactive

Private working artifact:
`.local/overnight-batch3/successor.py`

This is an implemented/tested installer and one-run driver, not an activated grant.
It requires exact candidate/package/helper/authority/evidence pins and parent review;
retains an exclusive fsynced nonrefundable install intent; installs fresh synthetic scope
and a new grant transactionally; verifies exact committed readback; inventories the
new clone alongside all old ledgers and deduplicates copied events; verifies original
source manifests/exhaustion; rejects unknowns/replay; drives only the named queued run
through the canonical worker/transport; checks STOP immediately before HTTP I/O and at
phase boundaries. No scheduler, replacement submission, refund, unknown resolution or
source grant mutation was introduced.

Independent helper review initially REQUIRED CHANGES:

1. Legacy readonly reader's database allowlist omitted the prepared clone.
2. STOP between count and generation was missed inside one worker visit.
3. Account evidence freshness trusted a wrapper timestamp instead of its hashed observation.

Parent fixed all three.46 controlled tests pass, including31 reviewer-authored cases
and the now-strict former failure cases. Actual readonly inventory/source/process gates
also pass. All33 source and33 prepared-clone table manifests remain unchanged. The two
unknown count attempts still contain exactly the original final count-send event.
No real helper draft/install/run mode or paid product request was executed.

Two bounded Astra reviewers were joined this batch. A follow-up delegation was refused
by the one-shot2/2 limit; no bypass was attempted. The changed helper hash
`81cfd85a6134a44636d7c4ca22b6aa1a0e15ae31e8a04eb20be6dd8d31162174`
therefore still needs focused independent review before live activation. Parent passing
regressions are not relabeled as that review. Initial review and every failed harness/
security probe remain available. First harness failures were isolated setup/import/
expectation mistakes, documented separately from product findings.

The preparation draft had2 admissions. The new uninstalled helper proposes3 admissions
across2 NEW conversations, sharing the SAME6 generation/count slots,100 reads,0 cancels,
token ceilings and$0.791520 allocation. This is not6 slots per admission. Historical
SQL019 prohibits reauthorizing an old conversation; it is unchanged. No old grant
repinning, scope transplantation or remaining-admission reuse is allowed. The prepared
clone is inert; the original active grant is admission-exhausted, NOT fenced.

The private held-out protocol is frozen in`.local/overnight-batch3/heldout-protocol.md`:
a new lending-library move request, genuine human correction and untargeted same-chat
constraint change, plus a distinct support-investigation request if canonical caps
permit. No outputs are prescribed, no target forced, no boundary-sized output padding,
no replacements. If a naturally saved body is not>8192bytes, that live criterion stays
untested; controlled large-body results are not misrepresented. Six slots might not
complete all three admissions. Preserve that outcome rather than raising caps.

## Money and counters

New product requests/spend in this batch:0/$0. No new encumbrance. Authorized cumulative
$40; prior encumbered$24.617200, unactivated$15.382800. Shared reserved liability$8.97056.
The frequently reported44 count/42 dispatch/377 reads are CLONE-LOCAL request counts;
all-lineage deduplicated counters are70 count/68 dispatch/566 reads. Both have0 cancels.
Local reservation$5.54064 plus carried$3.42992 equals$8.97056; copied events are not
charged twice. Mission encumbrance, reservations and provider billing are distinct.

IF a reviewed successor is installed, a NEW$0.791520 is encumbered, aggregate$25.408720,
unactivated$14.591280. None activated now. No billing claim or subscription-review$0
claim. Existing model metadata/pricing evidence must be rechecked for freshness before
execution. Both historical unknown counts remain quarantined, unchanged.

## Evidence and next useful step

Public:`evidence/overnight-20261015/batch3/manifest.json`, screenshots, raw independent
reviews, and parent retained-probe results. Private:`.local/overnight-batch3/` contains
all raw logs, disposable envs, full XML, helper/tests and read-only receipts. Never
print environment files or secret references. The original failed live traces remain
in their original path; no replacement runs or repaired outputs were made.

Batch4: reuse unchanged reviews; independently review only the fixed successor bytes
and final owner delta; complete exact-candidate packaging, route/account/pricing and
parent authority gates. Only then install on the inert clone and attempt the frozen
bounded natural probes through shipped HTTP/TUI. A full-suite post-fixture-fix check
can run concurrently on a fresh disposable DB. Retain every failure and give a final
morning report even if useful live autonomy remains partial. Comparative superiority,
selective proactivity, broad extensible agency and learned-memory usefulness remain
unestablished. No extra vendor accounts or paid competitor tests were authorized.
