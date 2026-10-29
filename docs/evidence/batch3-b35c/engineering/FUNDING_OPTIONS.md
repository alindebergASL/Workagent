# Finite funding/design options — offline, none activated

## Authority and retained evidence

The owner ceiling remains **$100 cumulative**, not $100 remaining. Reuse the completed13-store read-only reconciliation at2026-10-29 16:46:18–16:46:37: **$99.60596 retained allocation; $0.39404 globally unallocated;3 unknown generation usages and7 unmatched counts retained; billing unknown**. The original$20 stays encumbered. Usage is not settled billing; the gap between observed usage/reservations and allocations is not a refund.

This continuation did **not** repeat that reconciliation. It made one bounded read-only shape query in each of two historical stores to choose realistic bounds; `historical-shapes.json` and collector source retain that evidence. These are older/smaller schemas and prior Batch2 tasks, **not** a predictive full-tool A/B sample:

| Historical cohort | Dispatched / known usage | Input p95 / maximum | Output p95 / maximum | Reads p95 / maximum | Generations/attempt p95 / maximum |
|---|---:|---:|---:|---:|---:|
| Installed pool |373 /370|21,537 /31,800|2,059 /4,257|11 /33|6 /8|
| Batch2 continuation |25 /25|26,390 /28,850|1,609 /2,348|4 /4|3 /3|

Installed26/373 dispatched steps used more than8 reads. Twelve is a defensible bounded backoff design, **not** a guarantee that the historical33-read tail or new tasks finish. Forty covers the observed historical maximum without claiming a future bound. Six generations is a reasonable tighter trial setting but may constrain real tool work; failures must stay in the denominator. A32K-input/4K-output proposal is intentionally tight: one historical maximum exceeded4K output, and full-tool/memory/document growth can exceed32K input. The new short deterministic requests locally estimate at most17,176 tokens; that does not establish fit for held-out episodes. Never truncate quotes or human edits merely to fit.

## Pricing and enforceability

Retained public pricing documentation receipts (2026-10-29 15:21UTC, hashes included in the evidence manifest) describe the same official `gpt-6.1-sol` route: $2/M standard input, $0.10/M cached input, $2.50/M default30-minute cache-write input and $10/M output. The conservative bound uses **$2.50/$10 per million**, without assuming cache reuse, adding cache-write price twice, switching model or premium/long-context pricing. Public documentation retrieval is not a paid model probe; no new probe occurred here.

The **$0.01 per count/GET is an existing campaign engineering reserve, not a documented provider tariff**. The retained price table lists model tokens and priced hosted tools, but no separate Responses count/GET tariff. Absence of a listed price is not settled proof of free service. A future$0.001/operation reserve is a deliberately smaller *precautionary engineering reserve*, still counted and stopped at a finite total; it is not a measured fee or a refund. If a separately priced endpoint/mode is discovered, recost and stop before use. No new paid hosted tool/search/judge allowance is hidden in these tables.

The current product always dispatch-reserves50,000 input/8,192 output tokens ($0.20692). **Reducing a grant's aggregate tokens does not reduce this per-generation reservation.** The32K/4K options require a new versioned transport/predispatch/SQL reserve policy, historical observation compatibility, local preparation-fit rejection and targeted tests before live execution. This card did not implement that separate optimization. Existing per-run `max_steps` can cap selections; set7 for8 total generations or5 for6, reserving the final call. A future campaign adapter must durably count *all* attempts/counts and lifetime GETs per step across restarts, not reset on each worker visit. `poll_limit` alone is not this gate.

All full-sample alternatives retain12 trajectories/72 episodes, two variations in both A/B families, B0/B1/M1 and the original quality/safety/effort requirements. Lower caps can increase missing/failed episodes, which are reported rather than quietly replaced. None promises acceptance. The three-generation counters and prices are not a request to spend to the maximum.

## Exact comparison (USD reservation envelopes, not forecast fees)

Formula: generations × ((input cap×2.5 + output cap×10)/1,000,000 + (1 count + lifetime reads)×ancillary reserve). No cancellation, paid judge or paid search; reserve re-runs remain excluded unless separately specified.

| Option | Gens/episode; input/output; lifetime reads; count/read reserve | Model | Ancillary | Envelope | Cumulative if entirely new pool | Increase over$100 |
|---|---|---:|---:|---:|---:|---:|
| Original maximum, retained only |8;50K/8192;40;$0.01|119.18592|236.16|355.34592|454.95188|354.95188|
| Full sample, fewer reads |8;50K/8192;12;$0.01|119.18592|74.88|194.06592|293.67188|193.67188|
| **Full scope/caps, smaller ancillary reserve** |8;50K/8192;40;$0.001|119.18592|23.616|**142.80192**|242.40788|142.40788|
| Lean full sample, token/read caps |8;32K/4096;12;$0.001|69.67296|7.488|77.16096|176.76692|76.76692|
| Lean full sample, six generations |6;32K/4096;12;$0.001|52.25472|5.616|57.87072|157.47668|57.47668|
| **Paired seam pilot only:2 episodes** |2;50K/8192;4;$0.01|0.82768|0.20|**1.02768**|100.63364|0.63364|

`compare_envelopes.py` calculates every value with Decimal. The full-caps$142.80192 option changes neither sample nor model/token/read bounds; it requires a future revised ancillary gate. The$57.87072/$77.16096 alternatives are design options with real additional engineering and fit risk, not ready-to-run authority. There is **no single mandatory remaining funding amount before the design is chosen**. Raising the original ceiling to$454.95188 is not the only path.

## Lawful unused-pool reuse: examine one pool, do not add residuals

The installed pool's one effective cap is$67.62068; current model dispatch reserve$63.15616 plus historical carry$3.42992 equals$66.58608, leaving **$1.03460 inside the already-retained allocation**. Its remaining counters are5 generations,21 counts,268 reads,250,000 input and40,960 output tokens. Do not add predecessor caps or carry again. This is the preserved preflight snapshot, not a fresh admission fence.

The two-episode B1/M1 pilot uses4 generations,4 counts,16 reads,200,000 input and32,768 output tokens; **$1.02768 fits that single residual with$0.00692 left**, without using the global$0.39404. It could perform one real scoped tool action plus final explanation per arm on equal inputs. Four lifetime GETs match the small Batch2 cohort maximum but can leave background responses unresolved; no blind resend or unbudgeted later reads. Report that as failure/unknown, not success. This pilot omits B0, longitudinal change/correction/transfer episodes and full-family materials: it is **not** a substitute for full acceptance.

**No compatible unused full-tool pool is installed now.** The installed runtime is schema046 with older tools; its prompt/consumer/grant cannot simply be relabeled B1/M1. A future no-new-allocation rebind must fence the source pool from any competing new sends, carry its historical reservations and unknowns exactly once into one durable shared coordinator, bind both disposable candidate arms to the same account/project/data authority, keep unresolved original requests on their original identities, verify exact remaining money/counters under the admission lock, and install the lifetime read/attempt stop before any call. It must not mutate the installed data/service in this continuation. A copied grant in two independent stores is **not** a shared budget. Reuse is engineering work within standing authority only in a separately released live scope, not authorized by this preparatory task.

The expired$0.52616 and$0.52700 campaign residuals are listed for explanation **but are not added to capacity**: no current compatible gate, no atomic cross-pool rebind and no verified release from their lineage exists. The nominal expired$20 fixture is not a spendable allocation. No hypothetical sum is represented as funding.

## Specific next decision

Keep live execution blocked now. Choose either (a) a separately verified **$1.02768 paired seam pilot funded solely by lawful reuse of the single$1.03460 pool**, still owing full A/B afterward, or (b) a selected full-sample envelope and its exact additional ceiling shown above, with the stated prerequisite engineering. No new allocation/ceiling is adopted here. The original full A/B mission, later families and all disclosure/quality/safety requirements remain owed. No ownership/billing paperwork or reapproval of the finished zero-provider repair is needed.
