# Parent handoff — B3.4a publication candidate

## Parent acceptance addendum

The parent has verified the packaging tree, source/build/evidence/privacy hashes,
review closure and actual synthetic outputs and accepts the implementation's
stated mechanism scope. No production bytes changed and no completed journey was
rerun. Parent documentation changes are rebound by PRIVACY/EVIDENCE_MANIFEST and
the local `packaging/PARENT_STAGED_CANDIDATE.json`; the original staging receipt
remains historical. Exact commit, remote head and CI URLs/results are recorded in
the final parent task/PR receipt after publication, avoiding commit self-reference.
Completion releases existing `t_73a6251f`, not the full batch or private pilot.

## Retained packaging handoff

**Completed:** packaging `t_58f29c05` only. **Existing successor:** parent
`t_0ff857b1`; its remaining work is final acceptance, coherent feature commit/push,
exact-head CI and remote readback. Do not create another review/test/journey graph.
B3.4b (`t_73a6251f`) remains gated behind parent completion.

## Candidate and exact verification

- Use `/home/ubuntu/workagent-continuation-20261026`, branch
  `hermes/b2-conversational-client`, base
  `16923fef5f82f41c53e8242fe4e69e21de8da377`. Old auto-created c75fb58 trees are
  not candidates; do not copy/reset/clean them.
- All 32 implementation checkpoint hashes are unchanged. Source/build/evidence
  manifests, [acceptance map](ACCEPTANCE.md), same-reviewer reports, actual outputs
  and bounded privacy checks are in this directory. The original SECOND checkpoint
  is preserved unchanged; its formerly remaining rows are resolved by residual
  reports and this package, not silently edited into historical success.
- `.local/batch3/b34a/packaging/STAGED_CANDIDATE.json` gives the exact staged tree,
  paths, modes/blob identities and SHA-256 values. It is local-only to avoid a
  self-referential tree digest. Verify it before committing. Stage is only the 32
  intentional source files, root STATUS and this public evidence directory.
- Preexisting `contracts/pnpm-lock.yaml` remains untracked and excluded, exact hash
  `f04d544c1cc611dd3b4e6caa260b850cadf18be42ebd283308e5ff01aaad5a4d`.
  Do not use `git add -A`. Separate memory-link/Cloud work is not integrated.
- Retained build `HAEr4yziKBlWBIpt1euzS` matches 331 web/contracts inputs. Full
  current source binding covers 910 inputs; build binding covers 194 outputs and
  25 external traced files. It is not a fabricated build-time trace. Reuse this
  build unless actual consumed inputs change. Only isolated `.next` is involved.
- Fresh read-only test-04 verification matched all 68 final table snapshots and 67
  migrations; first 66 match base. Current human CSV/editorial IDs/versions/bytes
  match. No private/installed DB, old fixture or unknown run was modified.
- Same-reviewer code closure is reused without new invocations. Retained 98 and 25
  native/backend case totals overlap by 21; no additive total or broad-suite claim.

## Actual artifacts and retained privacy boundary

Use `outputs/duration-summary.csv`, `outputs/current-policy-brief.md` and
`outputs/B3.4a-verified-synthetic-outputs.zip`. ZIP SHA-256
`d42e43b2dd8203cef369372f003f63290688d3648b2d3ae20dfb3c4494ec846e`.
Correct stored attachment **7 belongs to package card `t_58f29c05`** and was
byte/hash/CRC checked. Historical malformed parent attachment **6** is not repaired
in place and must never be offered as the usable archive. `ATTACHMENT.json` records
both. Keep the warning/history; use the verified correction.

Raw envs, provider contexts/wires, opaque worker state/capabilities, full agent logs
and ANSI remain local and unstaged. Their hashes are retained in PRIVATE_BOUNDARY.
Evidence/publication manifests do not grant permission to publish those payloads.
No live model, causal benefit, private-account access or additional spending claim.

## Parent next actions, no reimplementation

1. Read this package and local staged receipt. Recheck hashes/index/lock before the
   coherent feature commit. No broad suites, duplicate journeys or new reviewer
   absent a concrete material delta. Parent may update docs to record its final
   acceptance/publication; rebind changed evidence/STATUS hashes and final tree.
2. Commit/push **only the feature branch**, verify exact remote SHA, and observe
   required CI on that exact head. Do not claim inherited CI for the new candidate.
   Publication/exact-head CI are pending at this packaging handoff.
3. Re-read the owned-service stop state at final handoff. Packaging started none:
   API18240/web13240 PIDs absent/connect refused111, compute-b34a inactive/MainPID0.
   Any necessary operation still requires exact PID/start/cwd ownership checks.
4. Complete parent only after its named acceptance/publication obligations; that
   releases existing B3.4b. No deploy/default merge/private pilot/cap increase.

If a real proof service is needed, read `.local/batch3/b34a/CONTINUATION.md` for the
owned recipe, explicit test-04 and tokenizer HOME/native-state wrapper. Never print
credentials or migrate 01/02 with revised 067. Existing useful outputs, grants/pins,
unknowns `4375…`, `ce503…`, `72481…` and historical failed reports stay preserved.
This is not a stopped mission or a new permission gate: the verified existing parent
is the next publication owner, not a newly invented workstream.
