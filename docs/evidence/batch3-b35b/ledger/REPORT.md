# B3.5b — current read-only ledger and authority reconciliation

**Outcome: no complete requested A/B tranche is affordable or installed. No paid trial ran.**

Observation window: **2026-10-29 15:29:50–15:30:10 UTC**. Repository source: `914043a62100b0c6d2ce6bc2fb89ed512b343067` (`hermes/b2-conversational-client`). This is a preparation result for `t_726f2c10`, not task-board completion or spending authority. All files produced by this work are in this directory.

## Decision and exact unmet envelope

“A/B” below means **families A and B**, each with two held-out variations, B0/B1/M1, six episodes per variation/variant, and up to eight **total** generation calls per episode. Final explanations, recovery and any model-powered preparation must fit that cap; there is no uncounted retry or auxiliary judge/search allowance. A trajectory means one variation of one family in one variant across six episodes.

Fresh accounting retains **$99.60596 allocated against the actual cumulative $100 owner ceiling**, leaving **$0.39404 globally unallocated**. That is not a provider bill. Existing campaign remainders are inside previous allocations, not additional global capacity.

| Proposed unit | Trajectories | Episodes | Generations/counts | Model reserve | Count/read reserve* | Total proposed reserve |
|---|---:|---:|---:|---:|---:|---:|
| One episode, not a longitudinal trajectory | — | 1 | 8 | $1.65536 | $3.28 | **$4.93536** |
| Minimum complete single-variant trajectory | 1 | 6 | 48 | $9.93216 | $19.68 | **$29.61216** |
| One family, both variations and all three variants | 6 | 36 | 288 | $59.59296 | $118.08 | **$177.67296** |
| **Families A/B** | **12** | **72** | **576** | **$119.18592** | **$236.16** | **$355.34592** |
| **Full A–G** | **42** | **252** | **2,016** | **$417.15072** | **$826.56** | **$1,243.71072** |

*The proposed bounded observation policy reserves one count and **at most 40 response reads over the entire lifetime of each generation**, at the **$0.01 per count/read engineering reserve actually enforced by both Batch2 campaign gates**. Forty is a proposed finite polling bound, not a provider fee or an existing grant requirement. The harness must stop observation at the bound, preserve unknown results/reservations and never silently reset the bound on another worker visit. Cancels are **zero**: actual campaign gates forbid them and the installed product grant has cancel limit zero. Existing grants do not have the counters to execute this table. No reserve was installed.

At 50,000 input and 8,192 output tokens, each model generation reserves **$0.20692** using $2.50/$10 per million. One episode reserves 400,000/65,536 input/output tokens; one trajectory 2,400,000/393,216; A/B 28,800,000/4,718,592; A–G 100,800,000/16,515,072. A/B also needs 23,040 response reads; A–G 80,640.

The decisive failure is not the conservative polling choice: **A/B model-only reserve $119.18592 exceeds the entire $100 ceiling even before all historical liabilities**. A–G model-only reserve is $417.15072. A single 48-generation trajectory's model-only reserve is $9.93216, also above currently established available room. If observation were restricted to only one read per generation, count/read-inclusive bounds would be $10.89216 per trajectory, $130.70592 for A/B, and $457.47072 for A–G; one read may leave work unresolved and is not a promise of completion.

**Precise unmet authority with historical allocation retained and no cross-pool reallocation:**

- A/B's proposed $355.34592 new envelope would bring cumulative allocations to **$454.95188**, exceeding the owner ceiling by **$354.95188**.
- A–G's proposed $1,243.71072 would bring cumulative allocations to **$1,343.31668**, exceeding it by **$1,243.31668**.
- A single proposed $29.61216 trajectory would bring cumulative allocations to **$129.21812**, exceeding it by **$29.21812**.
- Even one eight-call episode's model-only reservation exceeds global unallocated room. The installed active pool has capacity for only five more maximum-sized generations, not eight.

There is therefore **no affordable complete A/B tranche under this preregistered design**. A one-call or shortened smoke check is not a replacement for its longitudinal or comparative evidence. A later engineering successor could reconcile and rebind genuinely unused, already allocated room without seeking approval merely for changing an engineering cap, but it cannot manufacture capacity by refunding uncertain liabilities. The named current installed remainder ($1.03460), both expired campaign remainders ($0.52616 and $0.52700), and global unallocated room ($0.39404) sum to only **$2.48180** even under a hypothetical compatible, nonduplicating rebind; **that sum is not executable authority** and is still below one full trajectory's model-only bound. Old predecessor headroom must not be added again.

## Fresh installed and campaign state

All PostgreSQL snapshots used explicit **repeatable-read, read-only transactions**, bounded statement/lock timeouts, and rollback. The script imports no Workagent runtime, invokes no worker, and performs no provider count/generation/read/cancel request. Public pricing documentation was fetched separately through three unauthenticated HTTPS GETs, not the product API.

| Store / evidence | Current facts |
|---|---|
| Installed API PID `875172`, cwd `/home/ubuntu/workagent-candidates/general-review-20261023/backend`; database `workagent_test_47b87fe3b82e` | Active grant `workagent-continuation-20261022-15`; no grant expiry; schema through `046_cancelled_response_observation.sql`. Shared project model dispatch reservations **$63.15616**, historical carry **$3.42992**, combined **$66.58608**, one effective installed cap **$67.62068**, remainder **$1.03460**. Do **not** sum this grant with its predecessor caps. |
| Same installed pool counters | **373/378 generations**, **380/401 counts**, **1,281/1,549 reads**, zero cancels. Remaining **5 generations, 21 counts, 268 reads, 250,000 input tokens, 40,960 output tokens**. Seven unmatched counts and three unknown generation-usage steps remain held. |
| First paid Batch2 store `workagent_test_8c78561a8e8d`, campaign `t_62fc313f` | Grant inactive. Original **$1** allocation with prior allocation $92.10596. Two generations/counts, four reads. Model reserve **$0.41384**, ancillary reserve **$0.06**, commitment **$0.47384**, unused within old pool **$0.52616**. Deadline **2026-10-28 05:43:34.387116 UTC**, expiry **05:53:34.387116 UTC**; expired. |
| Continuation paid store `workagent_test_942379a11eb1`, campaign `t_ba6057bd` | Four linked grants are **one $6.50 pool**, not four allocations. Prior allocation **$93.10596**. Original/successor/sustained grants inactive; scheduled successor active but campaign expired. **25 generations, 25 counts, 55 reads**, zero cancels; all 25 results have usage. Model reserve **$5.17300**, ancillary reserve **$0.80**, commitment **$5.97300**, old-pool remainder **$0.52700**. |
| Same continuation admission limits | Latest grant: 27 generations/counts, 120 reads, two steps, 12 runs, no cancels; current campaign has 10 run configurations and one successor. Deadline and expiry **2026-10-28 07:53:30.408247 UTC**. Three enabled SQL triggers retain expiry, allocation and admission enforcement. Active grant boolean and null grant expiry do **not** override the expired campaign. |
| Closure store `workagent_test_cc58a1b9685a` | Discovered through `.local/step4-closure/test.private.env`. No official-mode product events or official grants. Its receipt-observer fixtures have historical expiries; they do not create a paid allowance. The real continuation store's receipt observer is inactive and expired. |

Environment-file **paths**, never DSN or bearer values, appear in `current-reconciliation.json`. The continuation, successor, sustained and scheduled environment files resolve to the **same paid database**. Closure verification operated on the actual paid store and a separate test store; neither creates an extra $6.50.

The exact active installed grant's retained request profile has 35 steps: `gpt-6.1-sol`, official origin `https://api.openai.com`, Responses API, reasoning `medium`, service tier `default`, max output 8,192, `background:true`, `store:true`, parallel tool calls false, truncation disabled. No explicit `prompt_cache_options` was retained. Synthetic-only and storage acknowledgement remain bound to the grant.

Installed prompt SHA256:
`254687aa29b35fa1d0e5eaef55c9eac8154a47e718cb8ef089db74bc3f9dca47`

Installed on-disk consumer SHA256, matching the active grant:
`65fcdb017ababcde2d6a171ec683e13abdc385e630cf16538171d91db3cb0921`

The installed selection-schema hash is `48af68f278c1d27bdd83167bdb5cffa9f52c97baffd5e6ff7ecb821ca6200042`. The installed source does not contain the candidate's retained-results, compute or typed-memory policy files. The continuation campaign used retained-results prompt `072555e79396e953bc6dbbc804ccd8043b23a7c87d2ffea21eefe81f8fe5dbb2` and selection schema `291bff85aa0ab207c3a148c94430ee49dcf5b164af9121032f859d481cdf0a4e`.

Current candidate on-disk consumer hash (103 explicitly enumerated source files):
`434ed220cc13a60dab49d84e8f767ca75cf3e71cc90c3360d62986c22dcb0e7e`

Candidate compute-policy hash: `fe02a66b7e8b97079a08a24198d01717985531bf9ae10ff50198c5e72d645ecc`.
Candidate typed-memory policy hash: `6c356854a76c32fa5eea902e26a7cb056658d292ee4c01adac52ab54f75a2b5a`.
These are source fingerprints, not a frozen/installed B0/B1/M1 experiment. Existing exact authority does not become a B3 study grant by copying it. The runtime explicitly treats historical prompt/consumer pins as provenance rather than a permanent architecture freeze; compatible runtime installation is engineering work. No assertion is made about already-loaded Python objects, availability of a new worker, or completion of candidate capability-selector configuration.

## Cross-store lineage, liabilities and billing

Freshly queried **13 distinct evidenced databases**, including the ten prior preflight stores, both subsequent paid campaign stores and the closure test store. This is deliberately scoped discovery, not an account-wide audit.

- Read and rehashed **34 retained original source files**, checked **207 primary accounting fields**, and directly read/rehashed **10 original members of the historical private evidence archive** without extracting it. Every checked hash/field matched the retained lineage. The first original **$20 remains fully encumbered**; it is not reconstructed from usage or treated as available room.
- Recomputed the additive lineage to **$92.10596**, then verified the separate live activation records and current campaign rows for **+$1** and **+$6.50**, yielding **$99.60596**. Zero-addition rebindings, failed/retried installation of the same allocation, successor caps and reservation carry are not counted as new allocations.
- All official-grant immutable hashes and active states in the ten earlier stores remain unchanged from the Batch2 preflight. The unrelated nominal $20 official-mode fixture has no attempts/configurations/events, is expired, and its immutable hash remains equal to the historically classified fixture. It is not a newly activated product allocation or a source of $20 spending room.
- Compared **31 carry rows** against the original source store/grant dispatch totals: all amounts matched. The installed $3.42992 carry is already represented by source events in the cross-store union and is not added again.
- Deduplicated by hashed event identity **and compared payload digest plus accounting projections**: **3,958 unique events**, **1,273 duplicate event copies**, **zero conflicting duplicates**. Per-store totals are not simply summed.
- Unique union: **433 count sends / 426 count results; 426 dispatches; 1,529 reads; zero cancels; 423 original results with usage; one historical corrected readback**. **Seven unmatched counts and three unknown generation-usage steps remain**. No claim of settlement or refund follows from absence of new events.
- Unique model dispatch reservations: **$72.17292**. Separately enforced Batch2 count/read reserves add **$0.86**, making **$73.03292 observed model-plus-those-campaign commitments**. This is not the $99.60596 allocation total, not a complete reconstruction of historical administrative reserves, and not permission to spend the difference.
- Known reported original-result usage: **5,090,043 input / 199,425 output tokens**. At conservative recorded rates this is **$14.7193575 for the known usage subset**. Three generation usages remain unknown. The corrected readback is separately enumerated, not silently substituted into original-result accounting or used as a refund.
- **Billed cost is unknown**. No billing export or billing endpoint was queried; no stored billed-cost fields were found in this projection. Usage-derived cost is not settled billing. Developer/reviewer/model-tool costs outside the product ledger are **separate and unquantified here**; they are neither charged against this product allocation by this report nor claimed to be zero/free.

## Current price basis

Fresh public documentation receipts are in `public-pricing-receipts.json` (three HTTP 200s at 2026-10-29 15:21:31–32 UTC):

- https://developers.openai.com/api/docs/models/gpt-6.1-sol.md
- https://developers.openai.com/api/docs/pricing.md
- https://developers.openai.com/api/docs/guides/prompt-caching.md

They list standard input $2/million, cached input $0.10/million, **default 30-minute cache-write input $2.50/million**, output **$10/million**. Use $2.50 input conservatively rather than assuming cache reuse or $2 input for every token. Cache writes are a token class/rate, not an additional $2.50 on top of $2 ordinary input. The bound assumes unchanged standard route, no premium regional/fast/ultrafast mode, no 12-hour cache-write option and no long-context surcharge; the 50,000-input-token cap is below the documented 272K threshold. A mode change requires recosting, not a route substitution.

The actual campaign $0.01 count/read reserve is **not** evidence of provider count/GET billing. Retain it when using those gates; a justified future engineering redesign may change it without converting it into an owner restriction. No model-powered judge/search is included. Local computation and public unpriced retrieval are not known-dollar-free services: disclose their usage/limits and any later monetary liability rather than silently counting paid tools as zero.

## Boundary classification and next engineering work

1. **OWNER LIMIT:** cumulative **$100**, including historical allocations/reservations/uncertain liabilities, is the actual limit. The full requested A/B and A–G worst-case model envelopes alone exceed it. Any budget increase or materially different design is not performed by this read-only card.
2. **ENGINEERING SETTING:** expired campaign time windows, selected trial subcaps, run/call/read limits, old scope schemas and missing installed B3 runtime configuration are engineering constraints—not reasons to ask the owner to reapprove routine work. Rebinding may be done by an authorized successor within genuinely available authority, preserving lineage and unresolved requests. Expiry does not reset cumulative allocation or release a liability.
3. **CURRENT CARD SCOPE:** this card explicitly prohibits spending, grant changes, installed DB/service modifications and board completion. All remain untouched. This narrower read-only task is not a new restriction on separately authorized implementation work.

A subsequent execution preflight must freeze B0/B1/M1 source/prompt/capability selectors and oracle separation, bind isolated synthetic stores and nonduplicating aggregate limits, re-read current ledgers under an actual admission fence, and resolve an affordable study design or a precise owner-budget change. No billing screenshot or account-ownership paperwork is demanded for the reaffirmed route.

## Reuse, verification and limitations

Run from the exact repository:

```sh
PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python .local/batch3/b35b/ledger/reconcile_readonly.py
PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python .local/batch3/b35b/ledger/verify_evidence.py
```

Add `--public-pricing` to refresh only the three unauthenticated public documentation receipts. The collector requires access to the named installed process environment and historical PostgreSQL peer-auth reads. It rejects a changed PID/cwd identity and fails closed with only an exception class, never raw DSN/exception text. It writes only beside itself. It never runs the older `docs/evidence/batch2-recovery5b/read_installed_ledger.py`, whose successor-cap summation is incorrect.

**Verified: 9 offline evidence tests passed**, including current readonly scope, primary source lineage, current campaign trigger state, carry and clone deduplication, unresolved-liability retention, installed prompt/consumer equality, exact cost arithmetic and sanitized output structure. See `verification.json` and `verification.log`. Collector first-run issues with legacy absent carry tables and multiline JSON aggregation were fixed; the final successful collector handles those schemas without mutations.

Files:

- `reconcile_readonly.py` — reusable scoped read-only collector and Decimal costing; no product imports.
- `current-reconciliation.json` — sanitized source/carry/store/grant/runtime/accounting evidence.
- `proposed-tranche.json` — proposed resource envelope, expressly `executable:false`.
- `verify_evidence.py`, `verification.json`, `verification.log` — reproducible evidence checks.
- `public-pricing-receipts.json`, `public-model-current.txt`, `public-pricing-current.txt`, `public-caching-current.txt` — timestamped public price sources and hashes.
- `last-run.log` — sanitized successful collector summary.
- `REPORT.md` — this report.

Limits: per-database snapshots are not an atomic cross-store transaction or spending fence; no unseen host/account/project inventory is claimed. Historical account availability evidence is not a fresh model metadata probe. No fresh provider identity, billing settlement, actual B3 usefulness, complete fixture/runtime compatibility or paid execution was tested. Preserve unknowns and rerun before any later spending decision.
