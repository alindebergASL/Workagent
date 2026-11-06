"""Read-only calculations from the retained 19:21 snapshot; no DB/network access."""
import hashlib
import json
from decimal import Decimal as D
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SNAP=ROOT/'.local/batch3/b35c/execution/ledger/current-reconciliation.json'

def calculate():
    d=json.loads(SNAP.read_text())
    unions=d['union_totals']
    # One store contains all three unknown generation identities. Do not sum clones.
    primary=d['stores'][0]
    unknown=[]
    for grant,a in primary['per_grant_accounting'].items():
        n=a['unknown_usage_steps']
        if n:
            count=a['counts']['dispatch']
            # The aggregate has 20k/8192 for every dispatch in these grants;
            # label assumption, not observed per-request settlement.
            assert D(a['reserved_input_tokens'])==count*20000
            assert D(a['reserved_output_tokens'])==count*8192
            unit=D('20000')*D('2.5')/1000000+D('8192')*D('10')/1000000
            assert D(a['reserved_cost_usd'])==unit*count
            unknown.append({'grant':grant,'unknowns':n,'retained_profile_per_dispatch_usd':str(unit),'model_reserve_bound_usd':str(unit*n)})
    assert sum(x['unknowns'] for x in unknown)==unions['unknown_usage_steps']==3
    live=[]
    for s in d['stores']:
        for g in s['grants']:
            if g['active']:
                live.append({'database':s['identity']['database'],'grant':g['id'],'expires_at':g['expires_at'],
                    'binding_cost_limit_usd':g['binding'].get('cost_limit_usd'),
                    'shared_reservation_plus_carry_usd':s['local_reserved_plus_carry_usd'],
                    'arithmetic_residual_NOT_transferable_usd':str(D(g['binding']['cost_limit_usd'])-D(s['local_reserved_plus_carry_usd']))})
    campaign=next(s for s in d['stores'] if s['identity']['database']=='workagent_test_942379a11eb1')
    counts=campaign['totals']['counts']
    held=D(campaign['totals']['reserved_cost_usd'])+D('.01')*(counts['count_send']+counts['read'])
    residual=D(next(g for g in primary['grants'] if g['active'])['binding']['cost_limit_usd'])-D(primary['local_reserved_plus_carry_usd'])
    assert residual==D('1.03460')
    model_episode=D('.20692')*8
    poll_envelope=model_episode+8*D('.01')+8*40*D('.01')
    return {'snapshot_sha256':hashlib.sha256(SNAP.read_bytes()).hexdigest(),'snapshot_at':d['at'],
      'provider_calls':0,'new_allocation_usd':'0','store_recollection':False,
      'known_usage_estimate_usd':unions['known_usage_calculated_usd'],'settled_billing':None,
      'unknowns':unknown,'unknown_generation_model_bound_usd':str(sum(D(x['model_reserve_bound_usd']) for x in unknown)),
      'unknown_bound_condition':'retained20k/8192 dispatch reservation profile and recorded rates; not a bill, excludes count/read tariffs and uncollected account activity',
      'unmatched_count_sends':unions['unmatched_count_steps'],'unmatched_count_conservative_at_campaign_policy_usd':str(D('.01')*unions['unmatched_count_steps']),
      'generation_reservations_usd':unions['reserved_cost_usd'],'known_usage_plus_unknown_generation_reserve_usd':str(D(unions['known_usage_calculated_usd'])+sum(D(x['model_reserve_bound_usd']) for x in unknown)),
      'active_flagged_grants_NOT_all_spendable':live,'expired_campaign_held_with_ancillaries_usd':str(held),
      'expired_campaign_unused_policy_envelope_usd':str(D('6.50')-held),
      'first_episode_sensitivity_NOT_a_cap':{'generations_including_final':8,'unit_model_reserve_usd':'.20692',
        'model_only_usd':str(model_episode),'with_one_count_one_read_per_generation_usd':str(model_episode+D('.02')*8),
        'with_count_and40_reads_each_usd':str(poll_envelope),
        'same_store_existing_model_residual_usd':str(residual),
        'same_store_additional_model_only_usd':str(model_episode-residual),
        'cumulative_ceiling_if_no_release_model_only_usd':str(D('99.605960')+model_episode-residual),
        'fresh_separate_envelope_no_transfer_ceiling_usd':str(D('99.605960')+poll_envelope)},
      'no_claim':'No residual is activated, transferred, refunded or spendable by this report. No fixed eight-call mandate. No entire-study reserve required by core SQL.'}

if __name__=='__main__':
    result=calculate()
    p=ROOT/'.local/batch3/b35c/preparation/funding-disposition.json'
    with p.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
    print(json.dumps(result,indent=2))
