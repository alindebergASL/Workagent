# Batch 3 — Final independent product acceptance, feature publication and runtime verification

Card: t_3186c309 · Run: this card's own run · Date: 2026-11-03 · Source head verified: `286a29601b5ca6993b969a9f21449b22be0acd0c`

## Verdict

**FULL BATCH 3 ACCEPTANCE: HOLD** — implemented/published increment VALID; live usefulness at head VERIFIED; full product acceptance cannot close while required evidence is genuinely missing. Exact next actions are listed at the end. No unresolved hard safety failure was found; no percent-pass is fabricated; every unmet requirement is named in the 45-row matrix (`MATRIX.md` / `MATRIX.json`, built programmatically from lane records by `build_matrix.py`).

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

## 6. Why HOLD, with exact next actions

1. **B3.5g corrected E/F/G re-run is executing** (t_4ccebe23, run 167, heartbeating). The 30 dependent-NR E/F/G rows are the missing "repeated useful outcomes under the P5-fixed product" evidence. Next action: let B3.5g complete, then re-run `build_matrix.py`-style aggregation over its REPORT/PRIMARY_ROWS and re-disposition the E/F/G + memory-benefit rows.
2. **Private pilot consent unanswered** (t_bb46e05f needs_input). Next action: owner answers the precise consent questions (named account/resource/processor); until then private-scope acceptance stays unmet — correctly, not silently.
3. **Memory benefit / human-effort reduction not established** in any completed study. Next action: B3.5g results + paired-arm analysis; do not claim causality from single trajectories.
4. **Provider billing unverified** (`provider_billed_usd=null`); encumbered 190.0597/275 with headroom 84.9403 is sufficient for B3.5g's incremental certificates. Next action: none required before B3.5g; re-read the ledger at its close.

## 7. Publication and reconciliation performed by this card

- Committed on `hermes/b2-conversational-client`: this evidence package, STATUS section, and the reconciled authority docs ($175→$275 wording matched to the installed issuer cap; historical receipts untouched).
- Reconciled concurrent writers: PR18 baseline verified (head == origin, no divergence); the only other active writer (B3.5g worker) owns `evaluation/b35g*.py` + `.local/batch3/b35g/` — untouched here. Prior lanes' untracked `evaluation/` harness scripts remain untracked deliberately (parent-owned dirty set; committing them mid-B3.5g risks racing its imports).
- Duplicate B3.5g card `t_f20dc3bf` archived (double-creation race; `t_4ccebe23` is the live one) — prevented a double paid dispatch.
- Bounded read-only independent review on this card's exact final changed scope: see `REVIEW.md` (prior unchanged reviews reused: PR19 APPROVE covers the P5 source; lane reviews cover B3.0–B3.5f).

## 8. Mission state

**CONTINUING** — B3.5g is the active paid successor (run 167); this card's acceptance increment is published and its runtime lane stopped cleanly. Full Batch 3 acceptance decision belongs to the card/lane that closes after B3.5g evidence lands; this HOLD is not a stop-work instruction.
