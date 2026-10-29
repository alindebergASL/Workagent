"""Offline design arithmetic. Never reads credentials, mutates pools or calls providers."""
from decimal import Decimal as D
from pathlib import Path
import json
BASE=Path(__file__).resolve().parent
prior=D('99.60596'); ceiling=D('100'); free=ceiling-prior
# Ancillary rates are prospective local reservation settings, NOT provider fees.
rows=[]
def add(name,kind,episodes,gen,input_tokens,output_tokens,reads,ancillary,changes):
    n=episodes*gen;rate=D(ancillary)
    model=D(n)*(D(input_tokens)*D('2.5')+D(output_tokens)*D('10'))/D(1000000)
    other=D(n)*(1+reads)*rate;total=model+other
    rows.append(dict(name=name,kind=kind,episodes=episodes,generations_per_episode=gen,
        generations=n,counts=n,reads=n*reads,reads_per_generation=reads,cancels=0,
        per_generation_input_cap=input_tokens,per_generation_output_cap=output_tokens,
        input_reservation_tokens=n*input_tokens,output_reservation_tokens=n*output_tokens,
        ancillary_per_operation_usd=str(rate),model_usd=str(model),ancillary_usd=str(other),
        total_usd=str(total),cumulative_if_new_pool_usd=str(prior+total),
        ceiling_increase_if_new_pool_usd=str(max(D(0),total-free)),changes=changes,executable=False))
add('Original maximum retained','full_AB',72,8,50000,8192,40,'0.01','Historical preregistration; not required spend or predicted fee.')
add('Same full sample; fewer reads','full_AB_amendment',72,8,50000,8192,12,'0.01','Keep existing money rate;12 lifetime reads, backoff; older tail up to33 may remain unresolved.')
add('Same full caps; smaller ancillary reserve','full_AB_reserve_amendment',72,8,50000,8192,40,'0.001','No sample/token/read narrowing; requires new future campaign gate with justified engineering reserve, not provider tariff.')
add('Lean full sample; capped tokens and reads','full_AB_amendment',72,8,32000,4096,12,'0.001','Needs versioned token/reservation implementation and fit checks; cannot merely reduce allowance under current fixed50k/8192 dispatch.')
add('Lean full sample; six generations','full_AB_amendment',72,6,32000,4096,12,'0.001','Same72 episodes/12 trajectories; fewer attempts may increase failures; original acceptance criteria and failure denominators unchanged.')
add('Paired B1/M1 seam pilot only','pilot_NOT_full_acceptance',2,2,50000,8192,4,'0.01','One full-tool action plus final per arm, no longitudinal/B0/family-quality claim. Existing token and money rates; strict4 lifetime GET bound.')
assert rows[0]['total_usd']=='355.34592'
assert rows[-1]['total_usd']=='1.02768'
result=dict(retained_allocation_usd=str(prior),global_unallocated_usd=str(free),billing='unknown',
    source_snapshot_at='2026-10-29T16:46:18.762910+00:00',no_new_allocation=True,provider_calls=0,
    rates_usd_per_million={'input':'2.5','output':'10'},designs=rows,
    reuse=dict(installed_pool_residual_usd='1.03460',compatible_now=False,
        potential_pilot_rebind_surplus_usd=str(D('1.03460')-D(rows[-1]['total_usd'])),
        old_campaign_residuals_not_added=['0.52616','0.52700'],
        condition='Future separately scoped atomic no-double-spend rebind, exact same account/data authority and retained liabilities. No pool mutation permitted in this continuation.'))
(BASE/'ENVELOPES.json').write_text(json.dumps(result,indent=2)+'\n')
for r in rows:
    print(f"{r['name']}: model={r['model_usd']} ancillary={r['ancillary_usd']} total={r['total_usd']} cumulative={r['cumulative_if_new_pool_usd']} increase={r['ceiling_increase_if_new_pool_usd']}")
print('Pilot unused-pool headroom:',result['reuse']['potential_pilot_rebind_surplus_usd'])
