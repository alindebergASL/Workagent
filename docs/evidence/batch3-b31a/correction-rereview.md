# B3.1a narrow correction rereview

**Verdict: PASS for closure of R1/R2 and the inspected subsequent test/contract delta.** The two concrete blockers in `independent-review.md` are resolved on the source hashes below. This is not whole-suite, production-release, Batch 3, or broader product acceptance.

Reviewed on 2026-10-28 (source/hash checkpoint 19:17:11Z), branch `hermes/b2-conversational-client`, HEAD/base `3cc340e6efea385000acac65a3b678a8d132a6a7`, including its uncommitted correction files. Read the prior independent review fully. Scope was deliberately limited to the two findings, their broker/client/adapter/SQL paths, focused fixtures and evidence, and additive contract generation. No new architecture audit or attack campaign was performed.

## Findings disposition

### R1 — PASS: nonempty-input stale execution now settles costs

`broker.py:93-96` removes appended source inputs and output/source refs when the post-I/O authorization check fails, retaining exactly the run-scope input required at the SQL binding boundary. It preserves the observed cost fields, including sandbox CPU, while clearing output and its hash. Migration 057 remains unchanged: extra call inputs are required only for an `observed` submission. The predecessor settlement function in migration 053 validates the exact receipt first, then strips **all** refs and omissions when current authority is absent; migration 055 also includes current file-resource authority in that decision. No binding relaxation was introduced.

The real nonempty-input regression executes the original sandbox adapter, retains an actual generated export, revokes the grant only after execution, and settles through PostgreSQL. Retained `closure-corrections-proof/post-io-revoke.json` records `cost_only`, null output, empty input/source/output refs and **167 ms CPU**. `publication-revoke.json` records both reserved and settled cost entries, one attempt, one retained but unpublished export, HTTP404 and denied replay. The sibling crash case retains only the reservation and also denies download/replay. These are positive cost-retention and negative publication assertions, not merely acceptance of an exception.

The earlier test expectation of one ref in the **returned** cost-only observation was wrong: one ref is required on submission to the exact binding check, but SQL strips it from the unauthorized result. Correcting that expectation to zero agrees with the existing protection; it does not weaken it.

### R2 — PASS: possibly submitted executions remain explicitly unknown

`client.py:33-65` marks possible submission immediately before `sendall`, conservatively including partial-send failures. Missing configuration/connect failures remain `SandboxUnavailable`. Post-submission transport failures, timeout/EOF, invalid JSON/receipt/profile/output validation become `SandboxOutcomeUnknown`. There is no transport retry loop. The new exception is not a `ValueError` and is not caught by the adapter's unavailable handler, so it reaches the broker's `outcome_unknown` path with null output, unknown cost basis and no observed units. Cancellation also remains non-successful rather than manufacturing an unavailable result.

The actual service-death regression waits for a computation cgroup, kills the owned service, and checks the broker/PG result. `closure-corrections-proof/lost-receipt.json` records `outcome_unknown`, `basis=unknown`, `observed_units=null`, both cost rows, **one dispatch**, and exact receipt replay after application service-object recreation. The reserved row remains one unit; the settled row's zero units is the existing SQL null-to-zero storage convention paired with **unknown** basis, not evidence of observed zero execution. No export was created. CPU in an unknown broker receipt is app-thread accounting, not a validated guest CPU measurement. The regression does not re-execute code during replay.

The separate real restart/disconnect checks passed. The final recovery helper performs a validated profile-bound `print('ready')` computation after the socket-connect probe; retained recovery evidence has `succeeded`, `ready\n`, and `cleanup_verified=true`.

## Material test and contract delta

- The HTTP fixture launches actual loopback TCP uvicorn on an inherited kernel-assigned listener and terminates its owned process. It is not TestClient evidence. Required request/schema headers are supplied.
- The download test checks exact returned bytes and manifest/header SHA256, `nosniff`, attachment disposition, and the API's actual global `Cache-Control: no-store` middleware. It checks anonymous401, wrong-workspace404, and404 after `memberships.active=false`. This is workspace-membership access withdrawal, not an isolated per-file revocation experiment. It does not delete FK-referenced membership/source/budget records.
- Retained final HTTP proof reports digest `c3bb4622c8bfcc703b496db47560d40842757459b6dac38b98f7cf4bb2a1a856` consistently in manifest, response header and checked bytes.
- `export_contracts.py` adds four canonical schemas: compute request, typed output, export manifest and opt-in compute decision. Existing outputs remain in the generator. **Reviewer executed** `PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python -B backend/export_contracts.py --check`: exit0, `Contracts match canonical Python models.` `git diff --check` also exited0. No contracts were rewritten by this review.
- Reviewer independently computed current compute implementation pin `5556a5b91f1f36506dc10c811e90bbf035dd4ee4288fa01b97d081edf9d10093`; both correction observation receipts match. Selection pin remains `b9f18beb013a8cd3f102959bf15a9fa290fbee43281077edc6e71abc547e5d61`, matching migration057. The broker is separately hash-pinned below; it is not inferred from the adapter implementation pin.
- No web-source modification appeared in the inspected worktree status. Untracked `contracts/pnpm-lock.yaml` was observed; it is outside this narrow runtime/schema correction approval and was not dependency-audited or installed by this reviewer.

## Evidence scope and retained failures

The following counts were parsed from actual JUnit XML, not inferred from progress dots; exit records and relevant logs/failure payloads were inspected. All paths in this section are under `.local/batch3/b31a/`.

| Evidence stem | Actual result | Interpretation |
|---|---|---|
| `closure-pg-current` | 12 pass / 2 fail, no errors/skips; exit1 | R1's returned-ref expectation and HTTP's missing request header failed. Other gateway/worker and lost-receipt checks passed. Not a green run. |
| `closure-corrections` | 5 pass / 1 fail, no errors/skips; exit1 | Both publication cases, service-death unknown accounting, isolation restart and disconnect passed. HTTP failed only its `private, no-store` expectation against actual `no-store`. |
| `closure-http-verified` | 1 pass, no failures/errors/skips; exit0 | Corrected real HTTP200/digest/401/404/revoked-access test completed. |

Intermediate `closure-http-corrected.xml` and `closure-http-final.xml` retain FK-deletion fixture failures. They were inspected and are not relabelled successful. The final fixture uses membership deactivation instead. No combined all-green historical run is claimed. The parent-owned core compatibility group is outside this rereview's completed-test claim; this reviewer neither reran it nor depended on an unobserved result.

This reviewer ran only read-only source/evidence inspection, hashing, canonical-contract checking and diff hygiene. **No sandbox job, service start/restart/kill, database write, provider request, source edit, Kanban action, or further delegation was performed.** Behavioral results above are inspected parent-run evidence, not newly executed reviewer tests.

## Reused installation/isolation scope

`resume-baseline.json` records verified immutable trees and matching service, profiles, protocol, results and installation modules. Installed profile remains `69ff94d387bef41a0210653b213bdae301a9e0600a62d273d469f34385b44578`. Its installed `client.py` differs from the corrected application transport; inspection of the service imports confirms that service does not import the client. No reinstall or new runtime tree is needed to assess this client-only correction. This rereview relies on the prior independent installation inspection plus the retained read-only baseline, not a fresh privileged filesystem audit.

The retained proof4 isolation file still contains **19 records**; its prior detailed review is reused, not repeated. Limitations remain unchanged: the inode workload reached gofer FD exhaustion, not demonstrated inode-cap enforcement; guest environment contains fixed PATH/LANG/TZ and runtime HOME, not an empty environment; gVisor and finite attack cases are not universal escape-proof evidence. Supplied tests and synthetic calculation oracles do not establish arbitrary user-goal correctness.

## Exact reviewed source and contract SHA256s

Paths are repository-relative. For large predecessor files, the hash identifies the whole file while review scope was the relevant settlement/authorization sections.

```text
244450c3ba9eee5798fb5a72bc53fea94cb550696230844d587dea29ac55bb0f  backend/workagent/capabilities/broker.py
922f5d922583c978dc651ba962fcb5fccb6c677f2d2a068784a786df747c226c  backend/workagent/sandbox/client.py
edd7732dafeb29ec614a26ca5d6b5cccc388c3e59d1ca3e9af85b026c87e6241  backend/workagent/capabilities/compute_adapters.py
86ac78347e084e609ce9a4936d7914cc803f8c0a271c3ff62886126913e3c79c  backend/workagent/capabilities/compute_composition.py
8e71d510ae5aa40396335ca7d082a8605e2f2311f3e615fecd779f9438d1b6cb  backend/migrations/057_compute_python.sql
f82b8fe693d1b93c48dfd9d98a886b12f151e315a10fb9d0e703d16bc4527858  backend/migrations/053_capability_gateway.sql
02af79c31cea3da1c3b4e49c692e6ec66cc20ca7c0415fcd92a1f8f841c8615d  backend/export_contracts.py
ae7e818cf378003c05914e05d10a9dfbc9c3b3c66265a8e015de3ee2af7e7ba5  backend/tests/compute_fixtures.py
2719a53611b337b2f8ff00fdc8db051b6d62fba9735f4464a063b16c43b39064  backend/tests/test_compute_publication_pg.py
8758eda666daaf38f0cd3c1791ac5a25683b836a2fda0c7f10bce8ad58323dd4  backend/tests/test_compute_gateway_pg.py
30013b26786f96ef0e911e70f80871614e3c8abbb3979915d0c564eef1e6b521  backend/tests/test_compute_isolation.py
789b9ff84b07f081fa65e1b4e6f232226390017f9cda1ed87d212229ec8ddd8a  backend/tests/test_compute_http_pg.py
edba81ab81c99b7f3a0360f7b962aa63d365a0d68770455fa0eb2a36b8847a59  backend/tests/test_compute_worker_pg.py
10352614c28a5a06d37a83e266a596749a5fa48a6a6b9cdf0bb09ae17b68aa47  contracts/compute-python.schema.json
6648479c5199aae1ef1223b9ec86f454e623d9a0f8496290465fb03f3bcf7a43  contracts/compute-output.schema.json
720af80bb3c691d1a9bf6c2f7684b3ab1aca42ec6801f3890d941e2b7f725c16  contracts/compute-export-manifest.schema.json
3ca5f9b0db9ec263bf0c9de0a59203b60836fb3d964e05a56bdaad05ed41529f  contracts/gateway-compute-decision.schema.json
5958cc1c416b4a5ebc1028cc937c566656bf567418fce343dcd72c3bfa6f4c93  contracts/capability-registry-v2.json
```

## Evidence SHA256s

Paths relative to `.local/batch3/b31a/`; broader manifests remain the parent's responsibility.

```text
be75b71be555127f3de9562a1bd738ad726e2b715a62d029a640e2f5a65ad5d0  closure-pg-current.log
cd14523e15427881b5f7c7b668b101750a0d4ce7b31f19692b00ad21a0e31c69  closure-pg-current.xml
4ce6e8358a57d18a42407959e9b94a449345775d81e6244b5bb48446e0d91f0f  closure-pg-current-exit.json
08990d5428caba1851ade7952ae905f01c388f1526e8ac45d48f1f7f732fa9cd  closure-corrections.log
dea6125dbdeaa5bbadb88db3bcfede13b11650ee81489bdd674786ed5aab3648  closure-corrections.xml
739a1e280aed914c5ba3da591db985e2eb2cabbcf355d62d6e136ef899424428  closure-corrections-exit.json
6d8defe53b1678b9c9da62aef8d5594dbc5efa9f9ba4951c8eb0af7afc67c127  closure-http-verified.log
76b30c9ffe56cb472d49e031fda452be572cc8366cb29003110276278050ace9  closure-http-verified.xml
7f5edcf11ad2458f03fe7d6c92e5945f18d079affbc290ead743c77ca28f63d6  closure-http-verified-exit.json
3ccab43fd6e5064d7a6420ad02a334c05adc4869127e81cc8982007057ad76c8  closure-corrections-proof/post-io-revoke.json
a2bea1e43d8ce4b3493df7cb0dc1cb2f8df96c47ae48574fc040746b822c1b3a  closure-corrections-proof/publication-revoke.json
0ce0d888fbdad86881113420a2596c1229a3975023678eb6ecbf8686597848c9  closure-corrections-proof/publication-crash.json
5b426e6be7e714356d805b62afb74638997d3426af7ae20372fe184c1d54f6b6  closure-corrections-proof/lost-receipt.json
4857b8b6c520595d3ce01e8d85a971ca764833ed0ff4ec055a956b6ae495d755  closure-corrections-proof/service-recovery.json
038d0b80c602c1404a802eab20bc5ff32b121f970bf456d3bb172497a6c8bedd  closure-http-verified-proof/http-download.json
81fb6b32ede9b646a070b0fda3909823816138cbc5e3b4d60b1b4704b4fcb243  resume-baseline.json
99584d59c6293bbf33c4a0da034c134965d96882fcff467317dbf95ad3f1cb1f  proof4/isolation.jsonl
```

**Only repository write by this reviewer:** `docs/evidence/batch3-b31a/correction-rereview.md`. No remaining blocker was found within this bounded correction scope. Later source changes require checking against these hashes; this report does not approve unidentified future bytes.
