"""Verify retained attempts, exact bytes, scope exclusions and frozen counts.
Publishes only content-free summaries/manifests; no oracle/fixture bodies.
"""
from pathlib import Path
import json
import sqlite3
import sys
from collections import Counter
sys.path.insert(0,str(Path(__file__).resolve().parent))
from harness import canonical,digest,files_manifest,load_study,write_new

ROOT=Path('/home/ubuntu/workagent-evaluator-b35b-v2')
OLD=Path('/home/ubuntu/workagent-evaluator-b35b')
REPO=Path(__file__).resolve().parents[1]
OUT=REPO/'docs/evidence/batch3-b35b'


def main():
    load_study(ROOT)
    run=ROOT/'execution-records/attempt-001'
    summary=json.loads((run/'summary.json').read_text())
    assert summary['attempts']==summary['passed']==252
    assert json.loads((run/'runtime-end-verified.json').read_text())['unchanged']
    raw=(run/'attempts.jsonl').read_bytes()
    journal=[json.loads(x) for x in raw.splitlines()]
    assert len(journal)==504
    schedule=[r for r in json.loads((ROOT/'trajectories/schedule.json').read_text()) if r['repeat'] in (1,2)]
    assert len(schedule)==42
    identities=set(); negatives=[]; trajectories=[];profiles={}
    secret=[bytes.fromhex(x) for x in json.loads((ROOT/'oracles/custody.json').read_text())['canaries_hex']]
    for trial in schedule:
        folder=run/trial['blind_id'];state=folder/'store'
        identity=json.loads((state/'identity.json').read_text())['store_id']
        assert identity not in identities;identities.add(identity)
        with sqlite3.connect('file:'+str(state/'continuity.sqlite')+'?mode=ro',uri=True) as db:
            assert db.execute('SELECT count(*) FROM episodes').fetchone()[0]==6
        for ep in range(1,7):
            result=json.loads((folder/str(ep)/'result.json').read_text())
            body=(state/f'request-{ep}.json').read_bytes()
            assert digest(body)==result['request_sha256']
            assert not any(s in body for s in secret)
            assert result['receipt']['previous_episodes']==ep-1
            assert all(result['receipt']['denials'].values())
            assert result['provider_calls']==0
            assert result['store_id']==identity
            if trial['variant'] in ('B1','M1'):
                profiles.setdefault((trial['case'],ep),set()).add((result['receipt']['policy_sha256'],result['receipt']['schema_sha256'],result['receipt']['model']))
        original=json.loads((ROOT/'fixtures'/trial['case']/'2/episode.json').read_text())
        request=(state/'request-6.json').read_bytes()
        assert original['project'].encode() not in request
        assert original['reviewed_lesson']['text'].encode() not in request
        context=json.loads(json.loads(request)['input'][0]['content'])
        assert context['raw_history']==[] and context.get('memory_context',[])==[]
        assert set(context['files'])=={'episode.json','new-task.md'}
        negatives.append({'blind_id':trial['blind_id'],'prior_project_and_lesson_excluded':True,'raw_history_empty':True,'old_tool_inputs_excluded':True,'product_SQL_forget_proven':False})
        trajectories.append({'blind_id':trial['blind_id'],'family':trial['family'],'variant':trial['variant'],
            'repeat':trial['repeat'],'episodes':6,'outcome':'transport_custody_pass_not_usefulness',
            'store_id':identity,'input_manifest_sha256':digest(canonical(trial['episodes'])),
            'outputs_manifest_sha256':digest(canonical(files_manifest(state))),'live_quality':'not_scored'})
    assert len(identities)==42 and len(profiles)==84 and all(len(x)==1 for x in profiles.values())
    history=[]
    for root in (OLD,ROOT):
        for folder in sorted((root/'execution-records').iterdir()):
            if not folder.is_dir():continue
            p=folder/'attempts.jsonl'
            if not p.exists():continue
            rows=[json.loads(x) for x in p.read_text().splitlines()]
            started=[r for r in rows if r['outcome']=='attempt_started']
            ended=[r for r in rows if 'ended_ns' in r]
            history.append({'corpus':root.name,'run':folder.name,'started':len(started),'ended':len(ended),
                'outcomes':dict(Counter(r['outcome'] for r in ended)), 'interrupted_without_result':len(started)-len(ended),
                'summary_present':(folder/'summary.json').exists(), 'journal_sha256':digest(p.read_bytes()),
                'artifact_manifest_sha256':digest(canonical(files_manifest(folder))),
                'qualification':'v1 not valid scope/forget control; runtime identity incomplete before attempt004' if root==OLD else 'current v2; no live usefulness'})
    result={'status':'offline_preparation_verified_live_trials_unfunded','primary_trajectories':42,'primary_episodes':252,
            'families':dict(Counter(x['family'] for x in trajectories)),'scope_negative_controls':len(negatives),
            'fresh_stores':len(identities),'same_B1_M1_policy_schema_model_pairs':len(profiles),
            'provider_calls':0,'live_trials':0,'quality':'not_scored','real_overnight':False,
            'runtime_lock_sha256':digest((ROOT/'runtime-lock.json').read_bytes()),
            'study_manifest_sha256':digest((ROOT/'manifest.json').read_bytes()),'study_freeze_sha256':digest((ROOT/'freeze.json').read_bytes()),
            'trajectories':trajectories,'scope_controls':negatives,'all_attempts':history,
            'historical_failures_retained':True,'private_pilot':'conditional_unmet','full_tool_SQL_M1':'pending_successor_repair_and_refreeze'}
    write_new(OUT/'RESULTS.json',canonical(result))
    for root,label in [(OLD,'v1'),(ROOT,'v2')]:
        rows=files_manifest(root)
        write_new(OUT/f'EVALUATOR_{label.upper()}_MANIFEST.json',canonical({'root':str(root),'files':rows,
                    'contents_not_published':True,'canaries_not_published':True,'count':len(rows)}))
    print(json.dumps({k:v for k,v in result.items() if k not in ['trajectories','scope_controls']},indent=2))


if __name__=='__main__':main()
