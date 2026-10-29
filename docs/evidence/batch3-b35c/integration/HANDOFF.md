# B3.5c residual integration — live-ready engineering handoff

**Residual engineering package complete; release remains locked. Full live study
and real-client acceptance remain incomplete.**

Implementation commit: `ea00377baa5b2d2ab335c4731e4a9ac2432e9789` on
`hermes/b2-conversational-client`, canonical workspace
`/home/ubuntu/workagent-continuation-20261026`.
This is commit **plus the inherited exact product delta**, not a clean-HEAD-only
candidate. `MANIFEST.json` binds the current controller sources, original product
manifest, frozen environment and final evidence. No deployment, remote publication
or default merge occurred.

## What changed

Only the useful R1–R4 corrections from the existing scoped review were integrated:
immutable accepted B0/current product anchors; original runtime/interpreter,
dependency/migration/tokenizer/lock pins across launch and restart; pre-effect
context disjointness and durable official-mapping identity; exact receipt-to-score
packet correspondence. See `REVIEW_CLOSURE.md` for locations, negative controls,
independent follow-up and the explicitly parent-verified final bytecode correction.

No run101 preparation was recreated. No alternate jail, public input/oracle
regeneration, funding redesign, fresh ledger collection or broad product audit was
performed. The old automatically created worktree was left untouched. Supplemental
receipt-binding commit `de3d8f2` was not cherry-picked: run102's already verified
additive binding suffices here; the supplemental preserved snapshot remains useful
historical evidence, not another prerequisite. Original review and receipts remain
unaltered.

## Executed evidence

| Evidence | Actual scope/result |
|---|---|
| Targeted tests | **43 PASS**:15 retained controller/transport controls +28 integration/receipt controls; includes full12-trajectory/72-row controller coverage |
| Final tiny fixture assertion | Two scoped retained receipt guards rerun PASS; not added to43 |
| Fresh representative longitudinal path | **18 scripted actual-worker episodes**, one six-episode trajectory in each B0/B1/M1 arm |
| Process recovery | Controller stopped after3 collected episodes, restarted as another process and continued to18; three actual worker interruption/resumes |
| Local transport | **126 loopback HTTP requests /63 scripted generations /0 duplicate create sends** |
| Output handling |18 blinded packets exactly matched collected receipts; scores remain null/pending |
| Retained full campaign | Previous72 scripted worker episodes read-only reverified under the stricter packet verifier; **not** a new current-candidate72-worker campaign |
| Preservation | Original run10257 hashes, runtime278 hashes and accepted B0103 files match; exactly five historical controller-manifest files intentionally differ, enumerated in `preservation.json` |
| Product effects | **0 paid calls,0 new allocations,0 installed mutations,0 ledger recollections,0 live A/B episodes** |

The representative run used the existing frozen public passages, exact oracle
hashes, actual isolated product workers, current B1/M1, retained accepted B0 and
new disposable PostgreSQL fixtures. It verifies plumbing, preservation, scope
boundaries and recovery—not generated-answer usefulness or model quality.
Diagnostic stores and old failure logs remain retained; installed stores and leases
were not touched. Existing normal50000-input/8192-output limits are unchanged;
scripted fixture max_steps8 is not a product acceptance limit. Disk headroom checked
at approximately23GB during the campaign.

## Final reproduction and binding

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=evaluation:backend backend/.venv/bin/python -m pytest -q evaluation/test_study_integration.py evaluation/test_study_controller.py
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=evaluation backend/.venv/bin/python evaluation/verify_study_diagnostic.py .local/batch3/b35c/integration-01 --episodes 18
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=evaluation backend/.venv/bin/python evaluation/verify_study_diagnostic.py .local/batch3/b35c/controller-12
python3 -B docs/evidence/batch3-b35c/integration/verify_preservation.py
```

All are local/no-provider checks. Historical campaign files are not rebound or
mutated by the read-only verifiers. Existing SQLite controller/bridge journals
cannot be silently resumed under changed bindings; start a separately named
campaign after deliberately reviewed source/environment updates. The original
network-13 environment and accepted source anchors are mandatory dependencies;
the attached ZIP is a code/evidence handoff, not a standalone DB/runtime image.

The new representative launch was precisely:

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=evaluation backend/.venv/bin/python evaluation/study_diagnostic.py --output .local/batch3/b35c/integration-01 --stop-after 3
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=evaluation backend/.venv/bin/python evaluation/study_diagnostic.py --output .local/batch3/b35c/integration-01 --stop-after 18
```

The stop points are diagnostic coverage boundaries, not new live-study caps.
The unchanged full schedule remains12 trajectories/72 episodes. Do not reuse this
scripted directory for live execution. Manifest creation follows all completed
writers, excludes itself and captures no stdout file while writing it. ZIP CRC and
all packaged hashes are verified; private diagnostic files remain in the workspace
with hashes, rather than bundling credential/connection/application state.

## Exact remaining activation boundary

`study_transport.LIVE_EXECUTION_RELEASE=None` is unchanged. Official controller,
adapter and worker remain fail-closed. **No installed-accounting maintenance
approval has arrived.** This package neither supplies that approval nor installs,
reuses, transfers, releases or enlarges any grant/allocation.

Root **t_e07c8870** owns the next admission decision and full execution. It must
resolve the existing specific installed-accounting approval and compatible funded
activation boundary before paid effects, then deliberately review any release
change, supply the exact disjoint context/grant/tool/configuration bindings and
inject credentials by the authorized route. Missing installed authority or an
unresolved child/provider effect remains a conservative hold requiring exact
identity reconciliation—not blind resend. This package does not claim the
unexercised official path has been live-validated.

The cumulative **$100 ceiling remains unchanged**, including historical and
uncertain liabilities. No micro limits or generic budget reapproval are introduced.
Earlier illustrative next-episode funding arithmetic is not an actual tariff,
compulsory minimum, approval or paid-study protocol. The funding diagnosis is
reused, not repeated; no new ledger snapshot was taken.

The full12 trajectories/72 **live** episodes, independent scoring, downloads,
desktop/phone/native usefulness and real client outcomes remain owed. Publication
and acceptance stay with **t_82b30c02**. Completing this residual releases the
existing root lane; it does not close the mission or authorize paid activation.

Development and the single narrow follow-up used GPT-6-Astra/openai-codex.
Development/review-tool billing is outside the product ledger and unreconciled.
No model/profile caps changed; no private access or additional task graph was added.
