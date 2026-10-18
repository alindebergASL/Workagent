"""Standing Home admission: real restricted PostgreSQL, no paid provider calls."""
import json
from decimal import Decimal
import pytest
import psycopg
from pydantic import ValidationError
from test_domain import context, cmd, raises
from test_conversations import conversation, post
from test_alpha_budget import binding, grant_for, CEILINGS
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from workagent.db import Database
from workagent.models import StandingResponsesBinding, ProviderGrant, PostMessage, CreateConversation, new_id
from workagent.provider_attempts import configure_grant, revoke_grant
from workagent.general_responses import consumer_hash, permits_conversation
from workagent.service import Service, Principal, canonical, encoded
from workagent.responses_dispatcher import ResponsesDispatcher
from workagent.responses_ledger import summary
from workagent.standing_admission import draft_standing_successor


def standing_grant(ctx, *, max_runs=40, **limits):
    _, p, ws, _, _ = ctx
    return ProviderGrant(id=new_id(), workspace_id=ws, principal_id=p.id,
        profile='general-responses-v1', model='gpt-6.1-sol', consumer_sha256=consumer_hash(),
        expires_at=None, max_runs=max_runs, max_received_output_tokens=16384,
        responses=StandingResponsesBinding(**binding([], 'proj_'+ws, **(CEILINGS | limits)),
                                          admission_policy='principal-workspace-v1'))


def install(ctx, **kwargs):
    g=standing_grant(ctx, **kwargs)
    configure_grant(Database(ctx[4]),g)
    return g


def test_fresh_home_dispatch_and_twelve_turns_keep_history_and_corrections(context,tmp_path):
    s,p,ws,_,_=context
    s.allow_controlled_turns=False
    g=install(context)
    from workagent.execution_status import admission_available
    with s.db.transaction() as c:
        assert admission_available(s,c,p,ws,g)  # Even before the first conversation.
    cv=conversation(context)
    assert s.get_conversation(p,ws,cv.id).conversation.model_activation=='active'
    fake=AlphaProvider([{'kind':'reply','text':'Retained synthetic response.'}])
    w=worker(context,fake,tmp_path)
    dispatcher=ResponsesDispatcher(w,workspace=ws,grant_id=g.id)
    for i in range(12):
        text=f'Human turn {i}; correction: use option B, not option A.'
        q=post(context,cv,text)
        result=dispatcher.once()
        assert result['results'][0]['run_id']==q.run.id
        assert result['results'][0]['status'] in ('completed','provider_pending')
        assert finish_safe_visits(context,w,q.run.id).state=='ready'
        detail=s.get_conversation(p,ws,cv.id)
        cv=detail.conversation
        assert detail.messages[-2].text==text
    assert len(detail.messages)==24
    assert all(r.state=='ready' for r in detail.runs)
    with s.db.transaction() as c:
        run=detail.runs[-1]
        material,_=s._materialize_general_context(c,p,run,cv)
        assert len(canonical(material).encode())<=262144
        assert len([m for m in material['messages'] if m['author_kind']=='human'])==12
        assert material['messages'][-1]['text']==text
        assert summary(c,g.id)['request_counts']['dispatch']==24
    # Restart reads retained state; no new grant, rebinding or history deletion.
    assert len(Service(s.db).get_conversation(p,ws,cv.id).messages)==24


def test_standing_scope_is_not_other_user_workspace_or_source_authority(context):
    s,p,ws,refs,admin=context
    s.allow_controlled_turns=False
    g=install(context)
    own=conversation(context)
    source=conversation(context,refs[:1])
    with Database(admin).transaction() as c:
        c.execute("INSERT INTO memberships(workspace_id,principal_id,role,active) VALUES (%s,%s,'editor',true)",(ws,'other-human'))
    other=Principal('other-human')
    theirs=s.create_conversation(other,ws,cmd(CreateConversation))
    with s.db.transaction() as c:
        assert permits_conversation(c,g.id,own.id)
        assert not permits_conversation(c,g.id,theirs.id)
        assert not permits_conversation(c,g.id,source.id)
        assert not permits_conversation(c,g.id,'missing')
    for principal,cv in [(other,own),(other,theirs),(p,theirs),(p,source)]:
        raises('unsupported_operation',lambda:s.post_message(principal,ws,cv.id,
            cmd(PostMessage,expected_work_version=cv.work_version,text='Not authorized for paid work')))
    raises('not_found_or_not_authorized',lambda:s.post_message(p,'other-workspace',own.id,
        cmd(PostMessage,expected_work_version=1,text='Not authorized')))
    from test_domain import ACTOR
    from workagent.fixture import seed
    other_ws='test-'+new_id()
    seed(admin,json.loads(ACTOR.read_text()),other_ws,p.id)
    elsewhere=s.create_conversation(p,other_ws,cmd(CreateConversation))
    raises('unsupported_operation',lambda:s.post_message(p,other_ws,elsewhere.id,
        cmd(PostMessage,expected_work_version=1,text='This workspace has no standing grant')))
    with s.db.transaction() as c:
        assert not permits_conversation(c,g.id,elsewhere.id)
    # Standing execution never makes every conversation a cross-conversation recall source.
    from workagent.work_context import permitted_conversations
    with s.db.transaction() as c:
        assert permitted_conversations(c,{'grant_id':g.id,'responses':g.responses.model_dump(mode='json')})==set()


def test_historical_scoped_grant_is_not_widened_or_overridden(context):
    s,p,ws,_,admin=context
    s.allow_controlled_turns=False
    old_cv=conversation(context)
    old=grant_for(context,[old_cv]); configure_grant(Database(admin),old)
    fresh=conversation(context)
    raises('unsupported_operation',lambda:post(context,fresh))
    assert post(context,old_cv).run.execution.grant_id==old.id
    revoke_grant(Database(admin),old.id)
    standing=install(context)
    assert post(context,fresh).run.execution.grant_id==standing.id
    old_cv=s.get_conversation(p,ws,old_cv.id).conversation
    raises('action_unresolved',lambda:post(context,old_cv))
    with s.db.transaction() as c:
        assert not permits_conversation(c,standing.id,old_cv.id)
        assert c.execute('SELECT data FROM provider_grants WHERE id=%s',(old.id,)).fetchone()['data']==old.model_dump(mode='json')


def test_revocation_and_membership_loss_prevent_dispatch(context,tmp_path):
    s,p,ws,_,admin=context
    g=install(context); cv=conversation(context); q=post(context,cv)
    fake=AlphaProvider([{'kind':'reply','text':'Must not execute.'}]); w=worker(context,fake,tmp_path)
    revoke_grant(Database(admin),g.id)
    result=ResponsesDispatcher(w,workspace=ws,grant_id=g.id).once()
    assert result['results']==[{'run_id':q.run.id,'status':'authority_unavailable'}]
    raises('action_unresolved',lambda:post(context,q.conversation))
    assert fake.calls==[]
    with Database(admin).transaction() as c:
        c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
    raises('not_found_or_not_authorized',lambda:s.get_conversation(p,ws,cv.id))


def test_run_cap_and_prior_shared_reservations_still_apply(context,tmp_path):
    s,p,ws,_,admin=context
    old_cv=conversation(context); old=grant_for(context,[old_cv],generation_limit=2)
    configure_grant(Database(admin),old)
    q=post(context,old_cv)
    fake=AlphaProvider([{'kind':'reply','text':'Historical use.'}]); w=worker(context,fake,tmp_path)
    assert finish_safe_visits(context,w,q.run.id).state=='ready'
    g=draft_standing_successor(Database(admin),old.id,grant_id=new_id(),max_runs=2)
    revoke_grant(Database(admin),old.id)
    configure_grant(Database(admin),g,predecessor_id=old.id)
    with s.db.transaction() as c:
        assert permits_conversation(c,g.id,old_cv.id)
        assert c.execute('SELECT data FROM provider_grants WHERE id=%s',(old.id,)).fetchone()['data']==old.model_dump(mode='json')
        assert c.execute('SELECT predecessor_id FROM general_grant_continuations WHERE successor_id=%s',(g.id,)).fetchone()['predecessor_id']==old.id
    for field in ('project_id','transport_mode','secret_reference','cost_limit_usd','generation_limit','count_limit','input_limit','output_limit','read_limit'):
        assert getattr(g.responses,field)==getattr(old.responses,field)
    with s.db.transaction() as c:
        before=summary(c,g.id,shared=True)
        assert before['request_counts']['dispatch']==2
        assert Decimal(before['reserved_cost_usd'])>0
    fresh=conversation(context); q=post(context,fresh)
    before_calls=len(fake.calls)
    assert w.work(p,ws,q.run.id).state=='partial'
    assert len([call for call in fake.calls[before_calls:] if call[1].endswith('/responses')])==0
    q=post(context,conversation(context))
    raises('budget_exhausted',lambda:post(context,conversation(context)))
    with s.db.transaction() as c:
        assert summary(c,g.id,shared=True)['request_counts']['dispatch']==2
        assert summary(c,old.id)['request_counts']['dispatch']==2


@pytest.mark.parametrize('policy,ids,max_runs',[(None,[],20),('unknown',[],20),('principal-workspace-v1',['cv'],20),('principal-workspace-v1',[],257)])
def test_invalid_opt_in_rejected_by_python_and_sql(context,policy,ids,max_runs):
    raw=standing_grant(context).model_dump(mode='json')
    raw['responses']['admission_policy']=policy; raw['responses']['conversation_ids']=ids; raw['max_runs']=max_runs
    if policy is None: raw['responses'].pop('admission_policy')
    with pytest.raises(ValidationError): ProviderGrant.model_validate(raw)
    with pytest.raises(psycopg.Error):
        with Database(context[4]).transaction() as c:
            c.execute('INSERT INTO provider_grants(id,workspace_id,principal_id,data) VALUES (%s,%s,%s,%s)',
                (raw['id'],raw['workspace_id'],raw['principal_id'],encoded(raw)))


@pytest.mark.parametrize('amounts,expected', [(['15.00','15.00'],'ready'),(['20.00','20.00','9.95'],'partial')])
def test_explicit_fifty_dollar_ceiling_counts_all_historical_carry(context,tmp_path,amounts,expected):
    from test_budget_carryforward import carry
    from workagent.budget_carryforward import install_carry
    s,p,ws,_,admin=context
    old=grant_for(context,[conversation(context)]); configure_grant(Database(admin),old)
    for amount in amounts:
        install_carry(Database(admin),**carry(context,reserved_cost_usd=amount))
    g=draft_standing_successor(Database(admin),old.id,grant_id=new_id(),max_runs=32,cost_limit_usd='50.00')
    assert g.responses.cost_limit_usd=='50.00'
    revoke_grant(Database(admin),old.id)
    configure_grant(Database(admin),g,predecessor_id=old.id)
    with s.db.transaction() as c:
        total=summary(c,g.id,shared=True)
        assert Decimal(total['reserved_cost_usd'])==sum(map(Decimal,amounts))
    cv=conversation(context); q=post(context,cv)
    fake=AlphaProvider([{'kind':'reply','text':'Within cumulative authority.'}])
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state==expected
    assert len(fake.responses)==(2 if expected=='ready' else 0)
    with s.db.transaction() as c:
        total=summary(c,g.id,shared=True)
        assert Decimal(total['reserved_cost_usd'])<=50
        assert Decimal(total['carried_reserved_cost_usd'])==sum(map(Decimal,amounts))
    raw=g.model_dump(mode='json'); raw['responses']['cost_limit_usd']='50.01'
    with pytest.raises(ValidationError): ProviderGrant.model_validate(raw)
    with pytest.raises(psycopg.Error):
        with Database(admin).transaction() as c:
            c.execute('SELECT require_alpha_budget_binding(%s)',(encoded(raw['responses']),))


def test_scoped_default_keeps_legacy_turn_bound(context):
    s,p,ws,_,admin=context
    cv=conversation(context); old=grant_for(context,[cv]); configure_grant(Database(admin),old)
    for _ in range(8):
        cv=post(context,cv).conversation
    raises('budget_exhausted',lambda:post(context,cv))
    assert len(s.get_conversation(p,ws,cv.id).messages)==8


def test_standing_successor_uses_old_and_new_conversations_without_rebinding(context):
    s,p,ws,_,admin=context
    cv=conversation(context); old=grant_for(context,[cv]); configure_grant(Database(admin),old)
    old_run=post(context,cv).run
    g=draft_standing_successor(Database(admin),old.id,grant_id=new_id(),max_runs=32)
    revoke_grant(Database(admin),old.id)
    configure_grant(Database(admin),g,predecessor_id=old.id)
    assert post(context,s.get_conversation(p,ws,cv.id).conversation).run.execution.grant_id==g.id
    assert post(context,conversation(context)).run.execution.grant_id==g.id
    with s.db.transaction() as c:
        row=c.execute('SELECT data FROM run_configurations WHERE run_id=%s',(old_run.id,)).fetchone()
        assert row['data']['grant_id']==old.id
        assert 'admission_policy' not in row['data']['responses']
    # Standalone replacement cannot launder historical counters through a project change.
    revoke_grant(Database(admin),g.id)
    bad=draft_standing_successor(Database(admin),g.id,grant_id=new_id(),max_runs=32)
    bad=bad.model_copy(update={'responses':bad.responses.model_copy(update={'project_id':'proj_different'})})
    with pytest.raises(psycopg.Error): configure_grant(Database(admin),bad,predecessor_id=g.id)
    # Owner-only drafting does not expose private route bindings to runtime callers.
    from workagent.runtime_config import BundleDenied
    with pytest.raises(BundleDenied): draft_standing_successor(s.db,g.id,grant_id=new_id(),max_runs=32)


def test_context_bounds_drop_old_payloads_not_current_intent():
    from workagent.conversation_context import bound_context
    messages=[]
    for i in range(40):
        messages.append(dict(id=str(i),run_id=str(i),sequence=i+1,author_kind='human' if i%2==0 else 'assistant',
            text=('Correction: keep the human decision. ' if i%2==0 else 'Assistant prose. ')*50,
            attachments=[{'ref':str(i),'content':'x'*10000,'sha256':'a'*64}],result={'large':'x'*10000}))
    current=dict(id='current',run_id='current',sequence=41,author_kind='human',text='CURRENT correction: B, never A.',attachments=[])
    original=json.loads(json.dumps(messages+[current]))
    material={'messages':messages+[current],'instructions':'trusted policy'}
    bound_context(material,'current',8000)
    assert len(canonical(material).encode())<=8000
    assert material['messages'][-1]==current
    assert any(m['sequence']==39 and 'Correction' in m['text'] for m in material['messages'])
    assert material['history_window']['omitted_messages']>0
    assert messages+[current]==original
