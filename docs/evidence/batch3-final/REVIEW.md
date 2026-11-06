# Independent review — Batch 3 final acceptance increment (commit 616592f)

Reviewer: independent read-only subagent (qwen3.8-max, deleg_c87b5f84), bounded to the exact changed scope of commit `616592f17b40017407528304f53198a64a853707` (docs/evidence only; no product source). Prior unchanged reviews reused, not re-run: PR19/P5 source review (GLM 5.3 APPROVE + codex), B3.0–B3.5f lane reviews.

**Verdict: APPROVE-WITH-NOTES** (14 matrix rows spot-checked against cited lane evidence; all denominators 29/3/40, 23/12/37, 19/2/51, 6/36 verified exact; HOLD verdict found consistent with rows; secret scan of all 35 committed files clean — no credentials/DSNs/bearer tokens; runtime.env confirmed untracked).

## Findings and dispositions

1. **major — issuer-readback/SUMMARY.json cap fields stale vs 275 headline.** The base readback script parses only 100/175 bodies, so `installed_issuer_cap_usd:"unrecognized"` / `cumulative_ceiling_usd:"175"` / negative availability are parser defaults, not installed authority. Reviewer independently verified the 275 cap in live `pg_proc` source (`cumulative_275_exceeded` guard, comment `cumulative_ceiling_usd=275`) and recomputed encumbered 190.0597 and headroom 84.9403 exactly. **Fixed:** added `issuer-readback/READBACK-NOTE.md` disclosing the stale fields and binding the prosrc verification; matrix budget row re-cites prosrc + note.
2. **minor — dangling `REVIEW.md` reference** in REPORT.md §7. **Fixed:** this file.
3. **minor — garbled inline build-id string** in REPORT.md §2 (build_id concatenated with its sha256 prefix). Underlying `BUILD_BINDING.json` verified sound by reviewer (recomputed sha256 matches). **Fixed:** REPORT.md corrected.
4. **minor — B3.5e episode locator wrong** ("ep4+"; lane report says all 6 trajectories terminated at the **episode-2** correction transition). Denominators verified exact. **Fixed:** MATRIX.* regenerated and REPORT.md §3 corrected.
5. **minor — internal LAN IP** (10.0.3.214) in records/reachability.json. RFC1918, no credential value; retained deliberately as the actual reachability evidence (the check's point is that the external interface refuses).

All fixes are in the follow-up commit on the same branch; CI re-watched at that exact head.
