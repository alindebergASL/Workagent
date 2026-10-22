"""Prototype defaults over real restricted PG and mock HTTP; no paid calls."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json

import psycopg
import pytest
from pydantic import ValidationError
from test_domain import context, cmd, raises
from test_conversations import conversation, post
from test_standing_admission import install, standing_grant
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker, target
from test_adaptive_execution import finish_safe_visits
from test_route_evidence_reload import fixture
from workagent.db import Database
from workagent.general_responses import verify_route_record, validate_grant
from workagent.models import ProviderGrant, HumanSave
from workagent.responses_ledger import summary
from workagent.responses_transport import TransportError, FrozenSchema
from workagent.service import encoded


@pytest.mark.parametrize('damage', ['future','naive','malformed','price','model','origin','authorization'])
def test_nonexpiring_route_still_rejects_invalid_evidence(damage):
    record,grant=fixture(); v=record['verification']
    if damage=='future': v['checked_at']=(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()
    elif damage=='naive': v['checked_at']='2020-01-01T00:00:00'
    elif damage=='malformed': v['checked_at']='not a timestamp'
    elif damage=='price': v['input_usd_per_million']='2.500001'
    elif damage=='model': v['model']='other-model'
    elif damage=='origin': v['official_origin']='https://other.example'
    else: v['authorization_sha256']='0'*64
    with pytest.raises(TransportError): verify_route_record(record,grant)


def retained(c,ws):
    return {table:c.execute(f'SELECT * FROM {table} WHERE workspace_id=%s ORDER BY run_id',(ws,)).fetchall()
            for table in ('run_configurations','provider_attempts','run_contexts')}


def test_installation_changes_use_same_grant_preserve_old_requests(context,tmp_path,monkeypatch):
    import workagent.general_responses as general
    import workagent.composition as composition
    from workagent.responses_dispatcher import ResponsesDispatcher
    s,p,ws,_,_=context; g=install(context); cv=conversation(context)
    q=post(context,cv); fake=AlphaProvider([{'kind':'reply','text':'Before installation'}])
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    with s.db.transaction() as c:
        before=retained(c,ws)
        steps=c.execute('SELECT * FROM responses_steps WHERE grant_id=%s ORDER BY attempt_id,phase',(g.id,)).fetchall()
        events=c.execute('SELECT e.* FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s ORDER BY e.id',(ws,)).fetchall()
    # Real change to a trusted closed DTO, not just replacing a saved grant pin.
    class CurrentDecision(composition.AlphaDecision):
        """Current installation contract with updated schema documentation."""
    schema=FrozenSchema.freeze(CurrentDecision.model_json_schema(),CurrentDecision)
    monkeypatch.setattr(composition,'DECISION_SCHEMA',schema)
    monkeypatch.setattr(composition,'POLICY',composition.POLICY+' Prefer concise source-grounded replies.')
    monkeypatch.setattr(general,'consumer_hash',lambda:'f'*64)
    validate_grant(g)  # Same startup validation the dispatcher uses.
    q2=post(context,s.get_conversation(p,ws,cv.id).conversation)
    fake2=AlphaProvider([{'kind':'reply','text':'After code-only installation'}])
    w=worker(context,fake2,tmp_path)
    record,_=fixture(); record['verification']['checked_at']='2020-01-01T00:00:00+00:00'
    record['grant_id']=g.id
    record['runtime']['product_project_id']=g.responses.project_id
    record['runtime']['secure_secret_reference']=g.responses.secret_reference
    frozen=deepcopy(record)
    w.phases.authority_check=lambda grant:verify_route_record(record,grant)
    dispatcher=ResponsesDispatcher(w,workspace=ws,grant_id=g.id)
    dispatcher.once()
    assert finish_safe_visits(context,w,q2.run.id).state=='ready'
    assert record==frozen
    with s.db.transaction() as c:
        assert c.execute('SELECT data FROM provider_grants WHERE id=%s',(g.id,)).fetchone()['data']==g.model_dump(mode='json')
        assert not c.execute('SELECT * FROM provider_consumer_successors WHERE grant_id=%s',(g.id,)).fetchall()
        after=retained(c,ws)
        for table,rows in before.items():
            assert all(row in after[table] for row in rows)
        assert all(row in c.execute('SELECT * FROM responses_steps WHERE grant_id=%s',(g.id,)).fetchall() for row in steps)
        assert c.execute('SELECT e.* FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s ORDER BY e.id',(q.run.id,)).fetchall()==events
        request=c.execute("SELECT request_bytes FROM responses_steps s JOIN provider_attempts a ON a.id=s.attempt_id WHERE a.run_id=%s AND s.phase='selection'",(q2.run.id,)).fetchone()
        payload=json.loads(request['request_bytes'])
        assert payload['instructions']==composition.POLICY
        assert payload['tools'][0]['parameters']==CurrentDecision.model_json_schema()
        assert summary(c,g.id,shared=True)['request_counts']['dispatch']==4


@pytest.mark.parametrize('amounts,expected', [(['20.00']*3,'ready'),(['20.00']*4+['19.95'],'partial')])
def test_hundred_cap_includes_historical_carry_and_atomic_reservations(context,tmp_path,amounts,expected):
    from test_budget_carryforward import carry
    from workagent.budget_carryforward import install_carry
    s,p,ws,_,admin=context
    g=install(context,cost_limit_usd='100.00')
    for amount in amounts: install_carry(Database(admin),**carry(context,reserved_cost_usd=amount))
    q=post(context,conversation(context)); fake=AlphaProvider([{'kind':'reply','text':'Within existing authority'}])
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state==expected
    assert len(fake.responses)==(2 if expected=='ready' else 0)
    with s.db.transaction() as c:
        total=summary(c,g.id,shared=True)
        assert Decimal(total['carried_reserved_cost_usd'])==sum(map(Decimal,amounts))
        assert Decimal(total['reserved_cost_usd'])<=100


@pytest.mark.parametrize('cost', ['100.000001','101','999','-1','1e2','0100','NaN',100,True])
def test_standing_numeric_bound_matches_sql(context,cost):
    raw=standing_grant(context).model_dump(mode='json'); raw['responses']['cost_limit_usd']=cost
    with pytest.raises(ValidationError): ProviderGrant.model_validate(raw)
    with pytest.raises(psycopg.Error):
        with Database(context[4]).transaction() as c:
            c.execute('SELECT require_alpha_budget_binding(%s)',(encoded(raw['responses']),))


@pytest.mark.parametrize('background',[False,True])
@pytest.mark.parametrize('when',['before_fetch','after_fetch'])
def test_public_read_cannot_publish_over_changed_human_target(context,tmp_path,monkeypatch,background,when):
    from test_public_retrieval_runtime import CHOICE, ANSWER, finish
    from test_public_retrieval import transport,wire
    from test_saved_work_retrieval import CheckedProvider
    from test_work_area_context import saved,document
    from test_general_alpha_runtime import activate
    from test_responsibility_execution import setup,edit,admitted
    from workagent import public_retrieval as reader
    from workagent.errors import DomainError
    s,p,ws,_,_=context
    if background:
        cv,a,assignment,g,life=setup(context)
        a=edit(context,a);s.advance_responsibilities(ws,g.id)
        rid=admitted(s,ws)[0]['run_id']
        change=lambda:edit(context,a,'Protected newer human decision')
    else:
        cv,a=saved(context);activate(context,cv)
        rid=post(context,cv,'Read evidence for this target',target=target(a)).run.id
        change=lambda:s.human_save(p,ws,a.id,cmd(HumanSave,expected_current_revision_id=a.current_revision_id,
                                                body=document('Protected newer human decision')))
    calls=transport(monkeypatch,[wire(b'Use 12 widgets.')])
    monkeypatch.setattr(reader,'fetch_public_url',reader.retrieve)
    changed=[]
    w=worker(context,CheckedProvider([CHOICE,ANSWER]),tmp_path)
    def hook(name):
        event='after_response' if when=='before_fetch' else 'after_tool_result'
        if name==event and not changed:changed.append(change())
    w.phases.hook=hook
    with pytest.raises(DomainError):finish(w,context,rid)
    assert len(calls)==(1 if when=='after_fetch' else 0)
    assert s.get_artifact(p,ws,a.id).current_revision==changed[0].current_revision
    with s.db.transaction() as c:
        assert not c.execute("SELECT 1 FROM conversation_messages WHERE run_id=%s AND author_kind='assistant'",(rid,)).fetchall()
        # SQL must also reject publication with a stale target/dependency.
        with pytest.raises(psycopg.Error):
            with c.transaction():
                c.execute('SELECT require_general_publication_authority(r) FROM runs r WHERE id=%s',(rid,))
