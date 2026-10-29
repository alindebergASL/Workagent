"""Read-only verification of the scripted controller output. No SQL/provider calls."""
import argparse
from collections import Counter
import json
from pathlib import Path
import sqlite3

from study_controller import Controller, canonical, digest, ingress, load_schedule


def verify(directory):
    database = sqlite3.connect(f'file:{directory / "controller.sqlite"}?mode=ro', uri=True)
    database.row_factory = sqlite3.Row
    rows = database.execute("SELECT * FROM operations WHERE operation='collect' AND state='complete' ORDER BY trial,episode").fetchall()
    assert len(rows) == 72
    _, schedule = load_schedule()
    trials = {t['blind_id']:t for t in schedule}
    expected = {(t['blind_id'],e['episode']):e for t in schedule for e in t['episodes']}
    assert {(r['trial'],r['episode']) for r in rows} == set(expected)
    assert not database.execute("SELECT key FROM operations WHERE state!='complete'").fetchall()
    binding = json.loads(database.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0])
    assert binding['mode']=='controlled_http'
    assert binding['sources']['B0'] != binding['sources']['B1'] == binding['sources']['M1']
    outcomes, runs = {}, {}
    resumed = 0
    for row in rows:
        p = json.loads(row['payload']); result = json.loads(row['result'])
        value = result['value']; identity=(row['trial'],row['episode'])
        assert result['payload_sha256']==digest(row['payload'])
        assert value['evidence_level']=='scripted_actual_product_SQL_and_HTTP_not_usefulness'
        assert value['input_files']==ingress(expected[identity])['input_files']
        assert value['message_sha256']==ingress(expected[identity])['message_sha256']
        assert value['oracle_sha256']==expected[identity]['oracle_sha256']
        assert value['status'] in ('ready','partial')
        outcomes[identity]=value
        runs[p['outcome']['run_id']] = identity
        if row['episode']==3:
            assert value['visits'][0]['state']=='interrupted'
            assert len(value['visits'])>=2
            assert value['visits'][0]['start_ticks'] != value['visits'][1]['start_ticks']
            assert value['visits'][0]['namespace_ids']['mnt'] != value['visits'][1]['namespace_ids']['mnt']
            resumed += 1
        if row['episode']==6:
            assert next(e for e in value['transitions'] if e['kind']=='other_project')['prior_artifacts_denied'] > 0
            if trials[row['trial']]['variant']!='B0':
                assert any(e['kind']=='forgotten' and e['status']=='forgotten' for e in value['transitions'])
        for visit in value['visits']:
            assert visit['source_manifest_sha256']==digest(canonical(binding['sources'][trials[row['trial']]['variant']]))
            assert visit['input_files']==value['input_files']
        for artifact in value['artifacts']:
            assert digest(canonical(artifact['body']))==artifact['body_sha256']
    wire=[json.loads(line) for line in (directory/'http-calls.jsonl').read_text().splitlines()]
    sends=Counter(); per_run=Counter(); memory=Counter()
    for call in wire:
        request=call['request']
        assert call['sha256']==digest(canonical(request))
        assert call['path'] in ('/v1/responses','/v1/responses/input_tokens')
        if call['path']!='/v1/responses':
            continue
        assert request['max_output_tokens']==8192
        key=(request['metadata']['attempt_id'],request['metadata']['step_id'])
        sends[key]+=1
        ctx=json.loads(request['input'][0]['content'])
        identity=runs[ctx['run_id']]
        per_run[ctx['run_id']]+=1
        humans=[m for m in ctx['messages'] if m['author_kind']=='human']
        assert digest(humans[-1]['text'])==outcomes[identity]['message_sha256']
        variant=trials[identity[0]]['variant']
        if variant in ('B0','B1'):
            assert not ctx.get('memory_context')
        elif ctx.get('memory_context'):
            memory[identity[1]]+=1
        if identity[1]==6:
            assert 'LOCAL-ONLY-REVIEW' not in canonical(ctx)
    assert len(per_run)==72 and all(n==1 for n in sends.values())
    for trial in trials:
        protected = [b['text'] for a in outcomes[(trial,2)]['artifacts'] for b in a['body']['blocks'] if b['kind']=='protected_note']
        assert len(protected)==1
        # Continued same artifact retains human text; new projects/analogous work
        # do not get the original protected paragraph re-injected by controller.
        for ep in (3,4):
            assert protected[0] in canonical(outcomes[(trial,ep)]['artifacts'])
        assert protected[0] not in canonical(outcomes[(trial,6)]['artifacts'])
    packets=list((directory/'evaluation-packets').glob('*.json'))
    assert len(packets)==72
    for path in packets:
        packet=json.loads(path.read_text())
        assert packet['quality'] is None and packet['effort'] is None
        assert 'variant' not in packet
    return {'status':'PASS','kind':'scripted_mechanisms_not_usefulness','trajectories':len(trials),'episodes':len(rows),
            'worker_interruption_resumes':resumed,'duplicate_create_sends':sum(n-1 for n in sends.values()),
            'loopback_requests':len(wire),'scripted_generations':len(sends),'blinded_unscored_packets':len(packets),
            'm1_memory_context_request_counts_by_episode':dict(memory),
            'paid_calls':0,'new_allocations':0,'installed_mutations':0,'live_episodes':0,
            'normal_max_output_tokens':8192,'model_quality':'unmeasured','client_usefulness':'unmeasured'}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path)
    print(json.dumps(verify(parser.parse_args().directory),sort_keys=True,indent=2))
