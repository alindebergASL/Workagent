"""Parent-run restricted PG: real local effects and ordinary immutable receipts.

No sockets: AlphaProvider is httpx.MockTransport. The historical case uses only
an exact old pure metadata function while constructing NEW disposable history.
No old event, descriptor, grant, request or SQL guard is rewritten.
"""
import ast
from copy import deepcopy
from datetime import timedelta
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch
import pytest

from test_domain import context
from test_workspace_files_pg import make,text
from test_conversations import post
from test_memory_full_tools import activated
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_local_rejection_settlement import journal
from retained_read_visits import finish_natural_visits
from workagent import adaptive
from workagent.capabilities import policy,registry
from workagent.capabilities.models import ToolGrantV1,CapabilityPin,InputRef
from workagent.db import Database
from workagent.models import new_id,now
from workagent.errors import DomainError

ROOT=Path(__file__).resolve().parents[2]
PREDECESSOR=ROOT/'.local/batch3/b35c/retained-read-recovery/implementation-60/predecessor-d3ac76bf6084d742877d59858ae8599809477cee9dbe37bdbd43b79dc509f274/adaptive.py'
CONTENT='Phase-bound retained draft é\nNo completion assertion.\n'


def assert_rejection_family(decision,expected):
    """Actual parser and higher-priority078 classifier, without DB or network."""
    import json,httpx
    from types import SimpleNamespace
    from test_memory_full_tools import config
    from workagent.responses_transport import build_tool_selection,RequestMetadata,Provenance,parse_response
    from workagent.selection_rejection import serialized_result
    from workagent.file_input_rejection import candidate
    instructions,schema=adaptive.contract(SimpleNamespace(**config('off')['responses']))
    request=build_tool_selection(instructions=instructions,source_context='{}',read_schema=schema,
        metadata=RequestMetadata(request_id='fixture-family',attempt_id='fixture-family',step_id='selection'),
        policy='adaptive-local-v1')
    fake=AlphaProvider([decision])
    response=fake.handle(httpx.Request('POST','https://controlled.invalid/v1/responses',content=request.body))
    parsed=parse_response(response.json(),request,Provenance(mode='synthetic',origin='fixture-family'),require_correlation=True)
    value=serialized_result(parsed)
    family='file_input_rejection' if candidate(request,value) is not None else 'selection_rejection'
    if family=='selection_rejection':
        assert parsed.state=='malformed' and parsed.issue=='schema_validation_failed'
    assert family==expected,(family,expected)
    return parsed


def fixture(ctx,gap):
    s,p,ws,_,admin=ctx;cv,file,_=make(ctx)
    human=s.get_artifact(p,ws,file.workspace_file_id)
    cv=s.get_conversation(p,ws,cv.id).conversation;pg=activated(ctx,cv,'off')
    q=post(ctx,cv,'Prepare a draft and a text download. Keep the existing human file untouched.')
    ref=InputRef(kind='workspace_file',id=human.id,version=human.current_revision_id,sha256=human.current_revision.body.content_sha256)
    ds=[registry.adapters()[n].descriptor for n in ('files.propose_patch','files.create_draft','artifacts.export')]
    grant=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=q.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in ds],
        resource_selectors=[ref],effects=['read','draft','local_compute'],privacy_classes=['workspace_private'],egress='none',
        expires_at=now()+timedelta(hours=2),access_generation=q.run.access_generation,budget_account_id=new_id(),allow_run_outputs=True)
    policy.install(Database(admin),grant,limits={'local_compute':10,'rendering':5},provider_grant_id=pg.id,
        amendment_sha256=sha256(b'disposable phase-bound60 current-source fixture authority').hexdigest())
    if gap=='selection_rejection':bad=dict(kind='reply',text=123)
    else:bad=dict(kind='files_propose_patch',ref=dict(workspace_file_id=ref.id,version_id=ref.version,sha256=ref.sha256),
        content=human.current_revision.body.content+'\nUnexecuted proposal',sha256=ref.sha256,reason='Unexecuted incorrect new-content hash')
    assert_rejection_family(bad,gap)  # Pure real parser/classifier before the costly worker prefix.
    def draft(ctx):
        observation=ctx['adaptive']['observations'][-1]
        assert observation['kind']==gap,observation['kind']
        return dict(kind='files_create_draft',source=text(CONTENT).model_dump())
    def export(ctx):
        r=next(r for r in ctx['run_output_refs'] if r['kind']=='workspace_file')
        return dict(kind='artifacts_export',input_ref=r,format='txt')
    fake=AlphaProvider([bad,draft,export],
        explanation='This run reached its selection limit; its requested goal is incomplete.')
    return q,grant,human,fake


def history(ctx,run_id):
    s,p,ws,_,_=ctx
    with s.db.transaction() as c:
        aid=c.execute('SELECT id FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',(ws,run_id)).fetchone()['id']
        result={name:c.execute(sql,args).fetchall() for name,sql,args in [
            ('steps','SELECT * FROM responses_steps WHERE attempt_id=%s ORDER BY phase',(aid,)),
            ('events','SELECT * FROM responses_events WHERE attempt_id=%s ORDER BY id',(aid,)),
            ('attempt','SELECT * FROM provider_attempts WHERE id=%s',(aid,)),
            ('native','SELECT * FROM tool_attempts WHERE workspace_id=%s AND run_id=%s ORDER BY id',(ws,run_id)),
            ('native_events','SELECT e.* FROM tool_attempt_events e JOIN tool_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s AND a.run_id=%s ORDER BY e.attempt_id,e.kind',(ws,run_id)),
            ('costs','SELECT c.* FROM tool_cost_entries c JOIN tool_attempts a ON a.id=c.attempt_id WHERE a.workspace_id=%s AND a.run_id=%s ORDER BY c.attempt_id,c.kind',(ws,run_id)),
            ('artifacts','SELECT * FROM artifacts WHERE workspace_id=%s ORDER BY id',(ws,)),
            ('revisions','SELECT * FROM revisions WHERE workspace_id=%s ORDER BY id',(ws,)),
            ('proposals','SELECT * FROM proposals WHERE workspace_id=%s ORDER BY id',(ws,)),
            ('workspace_files','SELECT * FROM workspace_files WHERE workspace_id=%s ORDER BY artifact_id',(ws,)),
            ('blobs','SELECT * FROM generated_blobs WHERE workspace_id=%s ORDER BY id',(ws,)),
            ('exports','SELECT * FROM artifact_exports WHERE workspace_id=%s ORDER BY id',(ws,)),
        ]}
    return result


def assertions(ctx,q,human,fake):
    s,p,ws,_,_=ctx
    e=journal(s,ws,q.run.id)
    assert e['selection_3','tool_result']['capability_result']['result']['export_id']
    with s.db.transaction() as c:
        rows=c.execute("SELECT a.call_id,e.data FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation' WHERE a.workspace_id=%s AND a.run_id=%s ORDER BY a.call_id",(ws,q.run.id)).fetchall()
        assert [r['call_id'] for r in rows]==['selection_2','selection_3']
        assert all(r['data']['status']=='observed' for r in rows)
    export_id=e['selection_3','tool_result']['capability_result']['result']['export_id']
    manifest,raw=s.download_export(p,ws,export_id)
    assert raw==CONTENT.encode() and manifest.blob.sha256==sha256(raw).hexdigest()
    assert s.get_artifact(p,ws,human.id).current_revision==human.current_revision
    return e


@pytest.mark.parametrize('gap',['selection_rejection','file_input_rejection'])
def test_pg_gap_final_ordinal_partial_and_exact_effects(context,tmp_path,gap):
    s,p,ws,_,_=context;q,g,human,fake=fixture(context,gap)
    result=finish_natural_visits(context,worker(context,fake,tmp_path),q.run.id)
    assert result.state=='partial' and result.stop_reason=='step_limit'
    e=assertions(context,q,human,fake)
    assert e['selection',gap]['terminal_outcome']=='continue'
    assert e['selection_3','tool_result']['terminal_outcome']=='step_limit'
    assert ('final','result') in e
    before=history(context,q.run.id);calls=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert history(context,q.run.id)==before and fake.calls==calls


@pytest.mark.parametrize('gap',['selection_rejection','file_input_rejection'])
@pytest.mark.parametrize('revoked',[False,True])
def test_pg_historical_continue_stop_preserves_all_receipts(context,tmp_path,revoked,gap):
    s,p,ws,_,admin=context;q,g,human,fake=fixture(context,gap)
    original=PREDECESSOR.read_bytes()
    import json
    binding=json.loads((PREDECESSOR.parent.parent/'PREDECESSOR_BINDING.json').read_text())
    assert sha256(original).hexdigest()==binding['dependencies']['product']['adaptive.py']
    fn=next(n for n in ast.parse(original).body if isinstance(n,ast.FunctionDef) and n.name=='stage_metadata')
    namespace=dict(vars(adaptive));exec(compile(ast.Module(body=[fn],type_ignores=[]),str(PREDECESSOR),'exec'),namespace)
    def hook(name):
        if name=='after_tool_result' and len(fake.contexts)==3:raise InterruptedError('exact historical bound stage retained')
    with patch.object(adaptive,'stage_metadata',namespace['stage_metadata']),pytest.raises(InterruptedError,match='exact historical bound stage retained'):
        finish_natural_visits(context,worker(context,fake,tmp_path,hook=hook),q.run.id)
    e=assertions(context,q,human,fake)
    assert e['selection',gap]['terminal_outcome']=='continue'
    other='file_input_rejection' if gap=='selection_rejection' else 'selection_rejection'
    assert ('selection',other) not in e
    assert e['selection_3','tool_result']['terminal_outcome']=='continue'
    assert not any(phase=='final' for phase,kind in e)
    before=history(context,q.run.id);calls=list(fake.calls)
    with s.db.transaction() as c:
        assert c.execute('SELECT bounded_phase_stop_settled(%s) ok',(before['attempt'][0]['id'],)).fetchone()['ok'] is False
    if revoked:
        with Database(admin).transaction() as c:c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(g.id,))
        with pytest.raises(DomainError):worker(context,fake,tmp_path).work(p,ws,q.run.id)
    else:
        result=finish_natural_visits(context,worker(context,fake,tmp_path),q.run.id)
        assert result.state=='partial' and result.stop_reason=='step_limit' and 'incomplete' in result.unresolved[0]
        with s.db.transaction() as c:
            cp=c.execute("SELECT data FROM run_checkpoints WHERE workspace_id=%s AND run_id=%s AND phase='final' AND checkpoint_kind='settlement'",(ws,q.run.id)).fetchone()['data']
            assert cp['waiting']=='none' and cp['next_safe_action']=='continue_slice'
            aid=before['attempt'][0]['id']
            assert c.execute('SELECT bounded_phase_stop_settled(%s) ok',(aid,)).fetchone()['ok']
            from workagent.general_responses import has_unresolved_attempt
            assert not has_unresolved_attempt(c,ws,q.run.conversation_id)
            checkpoint=c.execute("SELECT * FROM run_checkpoints WHERE workspace_id=%s AND run_id=%s AND phase='final' AND checkpoint_kind='settlement'",(ws,q.run.id)).fetchone()
            # Actual public lifecycle implementation and SQL successor gates;
            # rollback the proposed NEW run, never run it or copy old effects.
            with c.transaction(force_rollback=True):
                cv=s._conversation(c,p,ws,q.run.conversation_id,True)
                next_run=s._admit_run_successor(c,p,ws,cv,checkpoint['checkpoint_id'],checkpoint['checkpoint_hash'])
                assert next_run.id!=q.run.id and next_run.state=='queued'
        assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert history(context,q.run.id)==before and fake.calls==calls
    assert s.get_artifact(p,ws,human.id).current_revision==human.current_revision
