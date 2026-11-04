# Batch 3 — Final independent product acceptance, feature publication and runtime verification

Card: t_3186c309 · Run: this card's own run · Date: 2026-11-03 · Source head verified: `286a29601b5ca6993b969a9f21449b22be0acd0c`

## Verdict

**FULL BATCH 3 ACCEPTANCE: NOT ESTABLISHED / HOLD (recovery audit, 2026-11-04).** The scoped implementation and recorded development-runtime evidence remain valid at their stated source revisions. The later closure claim is not supported by the corrected denominators or the P7 evidence; this is an evidence disposition, not a new permission gate. Sections 1–5 retain the original 2026-11-03 checkpoint; §6 supplies the corrected later disposition. No new safety breach is established by this audit, but a target-mismatch denial is not proof of resource-specific revocation. The 45-row `MATRIX.json` and its full-field `MATRIX.md` rendering include the corrections; the historical `build_matrix.py` is stale, not their current generator. See [RECOVERY_CORRECTION.md](RECOVERY_CORRECTION.md) for derivation, limitations and reproduction.

## 1. Scope actually owned and executed by this card

Final independent acceptance assembly, verified publication/CI state, and a fresh owned loopback development runtime with real browser/PTY usefulness verification. This card made **zero paid product model calls** (all runtime journeys use the deterministic offline provider fixture; the only model spend in the ledger belongs to prior lanes and the concurrently running B3.5g card).

## 2. Candidate/source/content manifest

- Source head: `286a296` (PR18 head == local HEAD == origin at start; PR19 P5 fix merged into it with independent APPROVE + codex review).
- Web build binding: fresh `next build --webpack` from exact HEAD after removing stale `.next`; `BUILD_BINDING.json` records build id `6ousZ-E7SXIa9bC3QGoIP` (sha256 `5f73e0f0…`, full value in the record). All browser/PTY evidence below was re-collected against this fresh build.
- Runtime lane: fresh disposable PostgreSQL fixture (`workagent_test_b3final_*`, name-guarded), fresh restricted runtime role (the API's own `check_runtime_role` rejected the owner role — security check observed working), owned loopback services on 18452/13452 with PID/start-field/cwd ownership checks before every signal (b33b pattern).
- Evidence package: `docs/evidence/batch3-final/` (tracked); working set `.local/batch3/b3final/` (untracked, includes runtime.env with the lane-local dev bearer — never committed).

## 3. Requirement matrix (summary; full 45 rows in MATRIX.md)

| Group | State |
|---|---|
| B3.0a–B3.4b implementation lanes (13) | DELIVERED at each lane's own stated scope/qualifications (mechanism vs journey distinctions retained verbatim) |
| B3.5b harness | DELIVERED-qualified (offline-exercised; refuses live mode; V1 negative-transfer context defective/excluded) |
| B3.5c A/B original cohort | COMPLETE — negative/inconclusive (29/3/40 + 4 UNKNOWNs, immutable) |
| B3.5c fresh72 cohort | COMPLETE — negative/inconclusive (23/12/37; no complete 6-episode trajectory; masked scoring 17×3/3 + 6×2/3) |
| B3.5d C/D | COMPLETE-partial (19/2/51 of 72; dependent-NR root-caused to the P5 defect) |
| B3.5e E/F/G first pass | COMPLETE-partial (6/36 collected; all 6 trajectories terminated at the episode-2 correction transition with `missing_named_model_artifact`; ep2–6 dependent-NR) |
| P5 defect + fix | FIXED-verified (PR19 → head 286a296; review APPROVE; CI green; J1 below re-proves materialization on fresh fixture) |
| B3.5f overnight/resume | PASS with disclosed partials (6/6 episodes, 15h08m real gap; unattended routing PARTIAL; ep4 custody mismatch recorded) |
| B3.5g corrected E/F/G | **IN-PROGRESS** (card t_4ccebe23 run 167 ACTIVE; preflight done 01:17Z; 30 dependent-NR rows remain) |
| Memory benefit / effort reduction | NOT ESTABLISHED anywhere in Batch 3 |
| Negative transfer | PASS-mechanism (42 scope controls) + one real episode (b35f ep6) |
| Correction/forget/revoke/restore + human preservation | PASS-mechanism (19 deterministic rows) + narrow real (post-fix live check 2/2, b35f ep2/ep6, this card's J2) |
| Private named pilot | UNMET — consent gate t_bb46e05f open (needs_input); all connector evidence is public/synthetic and never labeled private |
| Hard safety failures | None unresolved in any lane record |
| Budget | Within installed 275 ceiling: certificates 122.00, released 31.54626, conservative encumbered 190.0597, headroom 84.9403, usage-upper 6.94086, unresolved reserves 0.39576; provider billing unverified |

## 4. Live runtime verification at head (all on the fresh build, owned services)

| Check | Result | Evidence |
|---|---|---|
| J1 P5 materialization, zero paid calls | PASS — `materialize_reply_artifact` audit event ×1, `reply.txt` editable worker artifact, exact reply bytes, run ready | records/j1-p5.json |
| J2 human edit preservation (human_save = web editor path) | PASS — human revision 2 on worker revision 1, parent link intact | records/j2-human.json |
| J3 separate-process readback | PASS — fresh interpreter returns exact human bytes | records/j3-restart.json |
| R1 service stop/restart, fresh PIDs | PASS — api/web PIDs differ, start-fields + cwd verified pre-kill | records/identity-*.json, restart-result.json |
| R2 HTTP output identical across restart | PASS — message + artifact sha256s equal before/after | records/snapshot-*.json |
| R3 download route exact named bytes | PASS — Content-Disposition `reply.txt`, bytes match artifact content sha256 | records/download.json |
| R4 reachability | PASS — loopback web 200; external interface 000 (refused) | records/reachability.json |
| Browser desktop1440/phone390/narrow320 | PASS — conversation + artifact page render; human edit visible; zero horizontal overflow at all widths; innerText readback asserted (not screenshots alone) | records/browser/ |
| PTY 80×24 and 120×40 | PASS — real pexpect+pyte keyboard/mouse through conversational TUI over live API: list → open → Work tab → saved-result select → human-edited body bytes rendered at both sizes; 80×24 required a real PageDown scroll journey (recorded) | records/pty/ |

## 5. Separate reports required by the card

1. **Implemented source**: Batch 3 implementation is complete at its lanes' stated scopes; head `286a296` carries the P5 fix with independent review. 
2. **Published head**: PR18 OPEN at `286a296`, exact-head CI success (frontend + development-boundaries). This card's docs/evidence increment is published on top (see §7) with its own exact-head CI watch; no default merge, no production replacement.
3. **Installed runtime**: `workagent-alpha` (8152/3152) serves OLDER source `d4d019c4` from a different root — disclosed drift, untouched by this card; no model-worker claim is made for it. The b3final lane runtime (18452/13452) was built and served from `286a296` exactly and is stopped after evidence collection.
4. **Live usefulness**: verified as in §4 — at head, real browser + real PTY + restart + readback + download, offline deterministic provider. This is verified development-runtime usefulness, **not** fresh paid-model usefulness (that evidence belongs to B3.5g and prior lanes).
5. **Consent-unexercised scope**: private named pilot remains unmet behind t_bb46e05f; nothing was labeled private that is public/synthetic.
6. **Full Batch 3 acceptance**: HOLD (see §6).

## 6. Corrected disposition (2026-11-04; supersedes the 2026-11-03 closure claim)

**Full product acceptance is not established.** The earlier **CLOSED** statement
relied on an unsupported total and an over-specific P7 interpretation. Completed
implementation, collected outputs and historical failed receipts are not erased.
This audit neither authorizes a replay nor rules out future bounded engineering.

1. **E/F/G dependent-row scope: 27/30 collected, not 37/40.** The frozen
   `b35g/PRIMARY_ROWS.json` defines six trajectories × episodes 2–6. b35g collected
   14/30; b35h continued the same cohort and collected 13 of the remaining 16.
   Deduplicated saved packet maps give **E 10/10, F 10/10, G 7/10**. G-M1 episode 4
   failed; episodes 5–6 remain unmet behind it. No extra cohort or ten additional
   rows supporting 37/40 was identified in the cited evidence.
2. **Broader E/F/G coverage must remain separately labeled.** Adding the six
   canonical b35e episode-1 rows gives **33/36 canonical evidence slots** across
   product versions. Separately, the continued b35g cohort has **33 collected
   packets / 36 execution slots**, including six fresh episode-1 prerequisites
   explicitly excluded from its primary evidence denominator. These are two views,
   not additive cohorts. Five trajectories completed 6/6; G-M1 stopped at 3/6.
   **27/30 is not an overall Batch 3 pass rate.** A/B, C/D, the b35e first pass and
   the separate b35f overnight observation retain their own denominators.
3. **P7: target-mismatch authorization stop established; resource-specific
   revocation PASS not established.** Saved execute/observe traces both stop at
   `original_attachments.material → retained_results.authorize`, line 94:
   `latest.target != original.target`. Saved message readbacks confirm episode 3
   has no target while episode 4 names an artifact revision. The episode-4
   instruction revokes the issue resource but permits release metadata; episode 3
   carries issues.json, release.json and prior-work.txt. A cross-run read of that
   message does not by itself identify which attachment was selected. The inspected
   saved traces do not bind the selected ref/hash to the specifically revoked
   resource. Withdraw the claims that the model necessarily re-read revoked issue
   content, that this proves the revocation boundary, that product/harness are
   defect-free, or that a future repair/evaluation would necessarily be gaming.
   The completed G-B1 sibling establishes an alternative observed path, not those
   stronger causal conclusions or byte-identical full model inputs.
4. **Quality and memory benefit remain qualified.** b35g manual scoring covers
   20 packets (including six prerequisites), with 84 mechanical checks true,
   zero false and eight deferred. b35h manual scoring covers 13 collected packets,
   with 44 checks true, zero false and nine deferred. The lane reports record
   manual PASS for those packets, not a 20/20 mechanical score over both lanes.
   No causal memory benefit or measured human-effort reduction is established;
   G completion differs by arm. These observations do not establish full acceptance.
5. **Other limits unchanged.** Private named-pilot consent remains unexercised.
   The saved b35g/b35h reports record encumbered 200.0597 and headroom 74.9403 under
   the 275 ceiling; b35h issued no new certificates. These are historical authority
   figures, not current balances or provider bills. Billing remains unknown; the
   asserted outage cause is not established by the inspected lane records. Runtime,
   source-publication and host-maintenance observations above are historical, not
   freshly reverified by this documentation-only audit.

Remaining evidence work: resolve P7's selected-resource identity and the
context-offer/authorization/error-handling discrepancy before claiming a
resource-specific safety pass or absence of a product/harness defect; preserve the
three unmet rows and the open benefit/consent/billing qualifications. No evaluation,
paid API, database operation, commit or push was performed for this correction.
