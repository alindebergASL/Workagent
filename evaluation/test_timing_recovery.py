"""Focused diagnosis controls; only the cold_handoff test connects to disposable PG."""
from copy import deepcopy
from hashlib import sha256
import cProfile
import json
import os
from pathlib import Path
import pstats
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4
from urllib.parse import urlsplit
import httpx
import pytest

from test_final_resume import context as pg_context, Wire, snapshot, events_by_key, wait_natural_expiry
from test_gateway_target_rejection import material
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_file_input_rejection import GoalProvider
from workagent.capabilities import policy, registry
from workagent.capabilities.models import CapabilityPin
from workagent.responses_transport import PreparedRequest, RequestMetadata
from workagent.responses_ledger import restore_result
from workagent.adaptive import contract
from test_memory_full_tools import config
from diagnose_timing_recovery import OUT, capture, cold, save, ORIGINAL_HASH
from timing_recovery_probe import Timings, safe_error


@pytest.fixture
def context():
    # Original study stores also use workagent_test_* names. Fail before seed or
    # any owner connection unless this is the explicitly authorized final fixture.
    runtime=urlsplit(os.environ['DATABASE_URL'])
    owner=urlsplit(os.environ['MIGRATION_DATABASE_URL'])
    assert runtime.path==owner.path=='/workagent_test_c0742ca73b11'
    assert runtime.hostname==owner.hostname and runtime.hostname in ('localhost','127.0.0.1')
    assert runtime.username!=owner.username
    return pg_context.__wrapped__()


def test_exact_projection_schema_profile():
    """Exact original bytes, no DB/authority claim; profile immutable validation only."""
    original, pending = capture()
    from pydantic import TypeAdapter
    from workagent.model_base import Text
    projected=json.loads(json.loads(original['steps'][0]['request_bytes'])['input'][0]['content'])
    assert TypeAdapter(Text).validate_python(diagnostic_prompt(projected))
    _, schema = contract(SimpleNamespace(**config('off')['responses']))
    root=OUT/('offline-'+uuid4().hex[:12]);root.mkdir()
    report = []
    profile = cProfile.Profile()
    profile.enable()
    try:
        for row in original['steps']:
            request = PreparedRequest(row['request_bytes'].encode(),RequestMetadata.model_validate(row['metadata']),
                row['phase'],schema,'adaptive-local-v1')
            assert request.sha256==row['request_sha256']
            assert request.count_body()==row['count_bytes'].encode()
            result = next((e['data'] for e in original['events'] if e['phase']==row['phase'] and e['kind']=='result'),None)
            if result:
                assert restore_result(result,request).state=='function_call'
            report.append(dict(phase=row['phase'],bytes=len(request.body),sha256=request.sha256,
                result_restored=bool(result)))
    finally:
        profile.disable()
        stats=pstats.Stats(profile)
        rows=[dict(file=Path(key[0]).name,line=key[1],function=key[2],primitive_calls=v[0],
            total_calls=v[1],self_seconds=v[2],cumulative_seconds=v[3]) for key,v in stats.stats.items()]
        save(root/'OFFLINE_PROFILE.json',dict(requests=report,
            calls=sorted(rows,key=lambda r:r['cumulative_seconds'],reverse=True)[:100],
            scope='exact frozen request/schema/result validation ONLY; cProfile overhead; no cold/SQL/authority timing proof'))
    assert pending['request_sha256']==ORIGINAL_HASH


def test_timing_aggregate_nested_counts():
    t=Timings()
    with t.span('outer'):
        with t.span('inner'):
            pass
        with pytest.raises(ValueError), t.span('inner'):
            raise ValueError('not logged')
    assert t.totals['startup:inner']['calls']==2
    assert t.totals['startup:inner']['errors']==1
    assert t.totals['startup:outer']['inclusive_seconds']>=t.totals['startup:inner']['inclusive_seconds']
    assert t.totals['startup:outer']['exclusive_seconds']>=0


def test_diagnostic_errors_never_include_private_payload():
    error=RuntimeError('postgresql://private-credential@example.test/?private-content')
    error.diag=SimpleNamespace(message_primary=str(error))
    assert safe_error(error)=={'error':'RuntimeError'}
    error.diag.message_primary='funding_scope_mismatch'
    assert safe_error(error)=={'error':'RuntimeError','reason':'funding_scope_mismatch'}


def test_probe_wrappers_preserve_validation_and_deny_http():
    # Install process-global diagnostic wrappers only in a disposable interpreter.
    # This checks the actual probe setup without SQL, sockets or a jail claim.
    code = '''
from diagnose_timing_recovery import capture
from timing_recovery_probe import Timings,install
from workagent.responses_transport import PreparedRequest,RequestMetadata
from workagent.responses_ledger import restore_result
from workagent.adaptive import contract
from types import SimpleNamespace
from test_final_resume import context
from test_memory_full_tools import config
import httpx,json
t=Timings();install(t,{'probe_phase':'selection_3'})
original,_=capture()
_,schema=contract(SimpleNamespace(**config('off')['responses']))
for row in original['steps']:
    r=PreparedRequest(row['request_bytes'].encode(),RequestMetadata.model_validate(row['metadata']),row['phase'],schema,'adaptive-local-v1')
    assert r.count_body()==row['count_bytes'].encode()
    for e in original['events']:
        if e['phase']==row['phase'] and e['kind']=='result':
            assert restore_result(e['data'],r).state=='function_call'
with httpx.Client(trust_env=False) as client:
    try:client.get('http://127.0.0.1:1')
    except AssertionError:pass
    else:raise AssertionError('HTTP was not denied')
assert any(e['event']=='forbidden_io_or_rebuild' for e in t.events)
assert any('model_json_schema' in key for key in t.totals)
assert t.totals['startup:PreparedRequest.count_body']['calls']==3
print(json.dumps({'wrappers_checked':True,'network_io':0,'measured_categories':len(t.totals)}))
'''
    result=subprocess.run([sys.executable,'-c',code],text=True,capture_output=True,timeout=60)
    root=OUT/('wrappers-'+uuid4().hex[:12]);root.mkdir()
    (root/'stdout.log').write_text(result.stdout)
    (root/'stderr.log').write_text(result.stderr)
    assert result.returncode==0, 'isolated wrappers failed; see '+str(root)


class AcknowledgedProvider(GoalProvider):
    """Two scripted selections use identity + GET, matching the retained shape."""
    def handle(self, request):
        response=super().handle(request)
        if request.method=='POST' and not request.url.path.endswith('input_tokens'):
            value=response.json()
            value.update(status='in_progress',output=[],usage=None)
            return httpx.Response(200,json=value)
        return response


def diagnostic_prompt(projected):
    transcript='\n'.join(m['text'] for m in projected['messages'])
    target_bytes=len(json.dumps(projected,ensure_ascii=False,separators=(',',':')).encode())
    prompt=projected['messages'][-1]['text']+'\nSynthetic diagnostic transcript (inert):\n'+transcript
    label='\nSynthetic inert payload: '
    padding=min(max(0,target_bytes-len(prompt.encode())-12000),max(0,10000-len(prompt)-len(label)))
    return prompt+label+('x'*padding)


def prepare(ctx, root):
    import test_gateway_target_rejection as target
    original, pending=capture()
    first=json.loads(next(r['request_bytes'] for r in original['steps'] if r['phase']=='selection'))
    projected=json.loads(first['input'][0]['content'])
    human=projected['target_body']['body']['content']
    results={e['phase']:e['data'] for e in original['events'] if e['kind']=='tool_result'}
    envelope={key:deepcopy(results['selection'][key]) for key in ('goal','success_criteria')}
    # Use the synthetic message and human target content from the frozen capture.
    # An inert quoted transcript supplies comparable bulk, not historical authority.
    # Fresh DB identities/target versions and tool results remain genuinely fresh.
    # Respect ordinary human-message ingress as well as unchanged model limits.
    prompt=diagnostic_prompt(projected)
    activate=target.activate; post=target.post; install=policy.install
    def bound(*a, **kw):
        kw['max_steps']=8
        return activate(*a, **kw)
    def ingress(ctx, cv, ignored, **kw):
        return post(ctx,cv,prompt,**kw)
    def authorized(db, grant, **kw):
        d=registry.adapters()['context.read'].descriptor
        grant=grant.model_copy(update={'capabilities':grant.capabilities+[CapabilityPin(
            id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256)]})
        return install(db,grant,**kw)
    with patch.object(target,'activate',bound),patch.object(target,'post',ingress),patch.object(target,'HUMAN_TEXT',human),patch.object(policy,'install',authorized):
        _, q, _, saved, _, _=target.prepare(ctx)
    decisions=[deepcopy(results['selection']['decision']),deepcopy(results['selection_2']['decision'])]
    fake=AcknowledgedProvider(decisions,lambda *a:deepcopy(envelope))
    wire=Wire(fake,root)
    # Preparation is local MockTransport with the existing immediate fixture
    # timeout. The measured cold worker uses unchanged production 100/105s gates.
    from workagent.responses_transport import ResponsesTransport
    from workagent.general_worker import GeneralWorker
    transport=ResponsesTransport.synthetic(httpx.MockTransport(fake.handle),origin=wire.origin)
    transport._client.timeout=httpx.Timeout(.1)
    count=0
    def stop(name):
        nonlocal count
        if name=='after_count':
            count+=1
            if count==3:
                raise InterruptedError('retained third count')
    w=GeneralWorker(ctx[0],transport=transport,state=root/'state',enable_responses=True,hook=stop)
    try:
        with pytest.raises(InterruptedError,match='retained third count'):
            finish_safe_visits(ctx,w,q.run.id)
    except BaseException:
        wire.close()
        raise
    finally:
        transport.close()
    before=snapshot(ctx,q.run.id)
    events=events_by_key(before)
    assert len(before['steps'])==3
    assert set(k for phase,k in events if phase=='selection_3')=={'count_send','count_result'}
    assert all(events[phase,'tool_result']['terminal_outcome']=='continue' for phase in ('selection','selection_2'))
    assert all(events[phase,'tool_result']['decision']==results[phase]['decision'] for phase in ('selection','selection_2'))
    row=next(r for r in before['steps'] if r['phase']=='selection_3')
    original_schema=json.loads(pending['request_bytes'])['tools'][0]['parameters']
    assert json.loads(row['request_bytes'])['tools'][0]['parameters']==original_schema
    save(root/'FIXTURE_DIFFERENCES.json',dict(original_bytes=len(pending['request_bytes'].encode()),
        fixture_bytes=len(row['request_bytes'].encode()),original_sha256=ORIGINAL_HASH,fixture_sha256=row['request_sha256'],
        same_schema=True,same_first_two_choices=True,same_goal_and_criteria=True,same_human_target_content=True,
        original_request_bytes_reused_for_authority=False,
        differences=['Fresh workspace/conversation/run/attempt/grants, file target/version and timestamps.',
            'Fresh actual read/discovery results; quoted transcript + inert padding, not original stored history.',
            'One human target, no prior episode accepted proposal/export or prior episode4 unknown/resolution.',
            'Synthetic provider provenance and fixed fixture count/usage, no copied funding/certificates.',
            'Full exact original context/request preserved only as diagnostic input and in separate cold clone arm.']))
    return q,saved,wire,before


def test_cold_handoff_synthetic_counted_third(context):
    root=OUT/('synthetic-'+context[2]);root.mkdir()
    q,human,wire,before=prepare(context,root)
    try:
        original_material=material(context)
        wait_natural_expiry(context,q)
        s,p,ws,_,_=context
        report=cold(s,p.id,ws,q.run.id,root,root/'state',mode='synthetic',origin=wire.origin)
        unchanged=snapshot(context,q.run.id)==before
        preserved=material(context)==original_material
        trace=report['trace'] or {'events':[]}
        handoffs=[e for e in trace['events'] if e['event']=='reservation_ready_callback']
        save(root/'ASSESSMENT.json',dict(handoffs=handoffs,immutable_history_preserved=unchanged,
            human_material_preserved=preserved,wire_calls=len(wire.calls),one_cold_attempt=True,
            no_optimistic_retry=True,scope='synthetic authority; handoff checked then transaction rolled back'))
        assert unchanged and preserved and not wire.calls
        # This fixture replaces the helper's BOM sample with captured public
        # human text. Compare its actual saved revision, not that helper constant.
        current=s.get_artifact(p,ws,human.id)
        assert current.model_dump(exclude={'observed_at'})==human.model_dump(exclude={'observed_at'})
        assert not s.proposals(p,ws,human.id).items
        revision=human.current_revision
        observed=s.read_workspace_file(p,ws,human.id,human.current_revision_id,
            revision.body.content_sha256)
        assert observed.text.encode('utf-8')==revision.body.content.encode('utf-8')
        assert report['returncode']==0 and report['trace'], 'probe failed; see retained TRACE/logs'
        assert not any(e['event']=='forbidden_io_or_rebuild' for e in trace['events'])
        assert len(handoffs)==1, 'did not reach reservation handoff on this cold visit; do not retry optimistically'
        assert handoffs[0]['allowed'], 'actual 105s handoff denied; measured evidence retained'
        assert any(e['event']=='http_window' and e['handoff'] and e['allowance']==105 for e in trace['events'])
        assert any(e['event']=='transaction_end' and e['disposition']=='rollback' and e['since_start']>handoffs[0]['since_start'] for e in trace['events'])
        # Report measured headroom; no assertion that three seconds proves enough
        # for unmeasured postcommit authority/HTTP. No commit or I/O was requested.
    finally:
        wire.close()
