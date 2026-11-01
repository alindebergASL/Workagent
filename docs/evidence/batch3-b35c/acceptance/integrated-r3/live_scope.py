"""Planning calculation only; no execution/allocation and no billing inference."""
import json
from pathlib import Path
from decimal import Decimal
from hashlib import sha256
P=Path(__file__).resolve().parent
raw=(P/'BUDGET_READBACK.json').read_bytes();budget=json.loads(raw)
reserve=Decimal(budget['generation_reserve_usd'])
# Normal max8 action selections plus final generation; retain40 observation reads.
generations=9;reads=40;ancillary=Decimal('.001')
per=generations*(reserve+(1+reads)*ancillary)
enc=Decimal(budget['encumbered_usd']);headroom=Decimal(budget['unallocated_usd'])
scopes=[]
for name,trajectories in [('separate_exploratory_AB_B1_M1_one_fresh_variation_per_family',4),('separate_original_sized_AB_B0_B1_M1_two_fresh_variations_per_family',12)]:
 episodes=trajectories*6;envelope=episodes*per
 scopes.append(dict(name=name,trajectories=trajectories,episodes=episodes,generation_limit=episodes*generations,count_limit=episodes*generations,read_limit=episodes*generations*reads,new_reservation_envelope_usd=str(envelope),cumulative_ceiling_needed_usd=str(enc+envelope),increase_over_existing_100_usd=str(max(Decimal(0),enc+envelope-100)),fits_current_headroom=envelope<=headroom))
r=dict(status='PROPOSED_SCOPE_NOT_EXECUTION_AUTHORITY',budget_receipt_sha256=sha256(raw).hexdigest(),budget_at=budget['at'],encumbered_usd=str(enc),headroom_usd=str(headroom),billed_usd=None,per_generation_reserve_usd=str(reserve),max_generations_per_episode=generations,max_reads_per_generation=reads,count_or_read_contingency_usd=str(ancillary),ancillary_is_official_tariff=False,episode_envelope_usd=str(per),whole_episode_fundable_with_unallocated=int(headroom//per),scopes=scopes,limitations=['Reservations are not forecast charges; all terminal NULL usage and unknowns remain retained.','Future certificates, exact source/inputs/oracle/request bindings and enforceable cumulative limits are not prepared or issued.','No additional paid judges, search, model children or cancellation; stop if task needs more than declared envelope, retain failure.','The smaller scope excludes B0 and independent replication; cannot establish original breadth comparison or population efficacy.','Do not run originals again; all new results must remain a separate cohort.','Each family still requires complete inputs, fresh useful outputs, human correction, process restart, source change, in-scope transfer, and other-project/forget denial; record active effort rather than infer it.'])
with (P/'LIVE_VALIDATION_SCOPE.json').open('x') as f:json.dump(r,f,indent=2);f.write('\n')
print(json.dumps(r,indent=2))
