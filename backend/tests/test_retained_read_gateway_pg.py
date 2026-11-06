"""Full-tool retained reads: parent-run restricted PG, synthetic HTTP only.

Positive staging is intentionally RED until the reviewed classification repair.
No registry/policy overrides, fabricated observations or descriptor-pin edits.
"""
from dataclasses import replace
from hashlib import sha256
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from test_timing_recovery import context  # Exact authorized disposable DB only.
import test_gateway_target_rejection as target_fixture
from test_conversations import conversation, post
from test_general_responses import worker
from retained_read_visits import finish_natural_visits
from test_local_rejection_settlement import journal, requests
from test_memory_full_tools import config
from workagent.adaptive import contract
from workagent.db import Database
from workagent.errors import DomainError
from workagent.models import AttachmentInput
from workagent.retained_results import material as retained_material


PHASE = 'selection_2'
ATTACHMENT = '\ufeffExact original attachment é🙂\r\nDo not normalize.\r\n'


def native_rows(ctx, rid):
    s, _, ws, _, _ = ctx
    with s.db.transaction() as c:
        attempts=c.execute('SELECT to_jsonb(t) v FROM tool_attempts t WHERE workspace_id=%s AND run_id=%s ORDER BY id',
            (ws,rid)).fetchall()
        return dict(attempts=attempts, **{table:c.execute(
            f'SELECT to_jsonb(e) v FROM {table} e JOIN tool_attempts a ON a.id=e.attempt_id '
            'WHERE a.workspace_id=%s AND a.run_id=%s ORDER BY to_jsonb(e)::text',(ws,rid)).fetchall()
            for table in ('tool_attempt_events','tool_cost_entries')})


def capture(ctx, path, kind='checkpoint', *, foreign=False, bad_attachment=False):
    s,p,ws,_,_=ctx
    # Reuse the valid scoped FileBody + full-tool provider/tool-grant fixture.
    # Only its test ingress receives an original attachment; product untouched.
    ingress=target_fixture.post
    def with_attachment(*a, **kw):
        return ingress(*a, **kw, attachments=[AttachmentInput(filename='original.txt',
            mime_type='text/plain',content=ATTACHMENT)])
    with patch.object(target_fixture,'post',with_attachment):
        cv,q,grant,human,_,_=target_fixture.prepare(ctx)
    other=post(ctx,conversation(ctx),'Separate scoped conversation') if foreign else None
    chosen={}
    def select(projected):
        name='read_attachment' if kind=='attachment' else 'read_result'
        assert any(d['name']==name and d['availability']=='available'
            for d in projected['composition']['capabilities'])
        if kind=='attachment':
            item=next(i for i in projected['evidence_context']['attachments']['items']
                if i['message_id']==q.message.id)
            decision=dict(kind=name,**{k:item[k] for k in ('message_id','ref','sha256')},offset=0,limit=8192)
            if bad_attachment:decision['sha256']='0'*64
        else:
            prior=journal(s,ws,q.run.id)['selection','tool_result']
            assert prior['decision']['kind']=='files_read_range'
            assert prior['capability_result']['result']['text']==target_fixture.HUMAN_TEXT
            cp=next(cp for cp in s.list_run_checkpoints(p,ws,cv.id).items
                if cp.run_id==q.run.id and cp.phase=='selection' and cp.checkpoint_kind=='stage')
            decision=dict(kind=name,run_id=other.run.id if other else q.run.id,phase='selection',
                operation_hash=prior['binding']['operation_hash'] if kind=='native' else cp.checkpoint_hash,
                offset=0,limit=8192)
        chosen.update(decision)
        return decision
    def answer(projected):
        observation=projected['adaptive']['observations'][-1]
        assert observation['decision']==chosen
        assert observation['capability_result']['capability']==chosen['kind']
        return dict(kind='reply',text='The bounded retained read was observed; no human work was changed.')
    source=dict(kind='files_read_range',ref=dict(workspace_file_id=human.id,
        version_id=human.current_revision_id,sha256=human.current_revision.body.content_sha256),offset=0,limit=8192)
    fake=target_fixture.TargetProvider([source,select,answer])
    captured={}
    stage=s.stage_general_product
    def stop(cap,receipt,phase='selection'):
        if phase==PHASE:
            captured.update(cap=cap,receipt=receipt,phase=phase)
            raise InterruptedError('exact retained read before staging')
        return stage(cap,receipt,phase)
    before=target_fixture.material(ctx)
    with patch.object(s,'stage_general_product',stop):
        with pytest.raises(InterruptedError,match='exact retained read before staging'):
            finish_natural_visits(ctx,worker(ctx,fake,path),q.run.id)
    saved=journal(s,ws,q.run.id)
    assert saved[PHASE,'result']['value']['decision']==chosen
    assert all((PHASE,k) in saved for k in ('count_send','count_result','dispatch','identity','read','result'))
    assert (PHASE,'tool_result') not in saved
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()
    native=native_rows(ctx,q.run.id)
    assert len(native['attempts'])==1
    assert native['attempts'][0]['v']['capability_id']=='files.read_range'
    assert target_fixture.material(ctx)==before
    return q,grant,human,fake,captured,saved,requests(s,ws,q.run.id),native,before


@pytest.mark.parametrize('kind',['checkpoint','native','attachment'])
def test_full_tool_retained_read_staging_restart(context,tmp_path,kind):
    s,p,ws,_,_=context
    q,grant,human,fake,args,events,steps,native,before=capture(context,tmp_path,kind)
    calls=list(fake.calls)
    try:
        # Minimal RED: current valid choice raises unsupported_operation here,
        # in Products.stage_general_product -> policy.require_operation.
        staged=s.stage_general_product(**args)
        assert staged['decision']==events[PHASE,'result']['value']['decision']
        read=staged['capability_result']
        assert read['capability']==staged['decision']['kind']
        with s.db.transaction() as c:
            from workagent.general_responses import resolve_selection
            actor,run,cv,decision,_,_,_=resolve_selection(s,c,**args)
            rows=c.execute('SELECT data FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s AND phase=%s',
                (ws,q.run.id,PHASE)).fetchall()
            raw=retained_material(s,c,actor,run,cv,decision,projection=rows[0]['data'].get('projection_version','legacy-v1'))
        assert len(rows)==1 and rows[0]['data']['result']==read['result']
        assert raw is not None and read['result']['status']=='available'
        assert read['result']['body_sha256']==sha256(raw).hexdigest()
        assert read['result']['text'].encode()==raw[:read['result']['next_offset']]
        if kind=='attachment':assert read['result']['text']==ATTACHMENT
        # Exact restaging/restart must not create another range receipt or tool.
        assert s.stage_general_product(**args)==staged
        assert fake.calls==calls
        assert finish_natural_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
        completed=list(fake.calls)
        assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
        assert fake.calls==completed
        after=journal(s,ws,q.run.id)
        assert all(after[k]==v for k,v in events.items())
        assert all(requests(s,ws,q.run.id)[k]==v for k,v in steps.items())
        with s.db.transaction() as c:
            assert c.execute('SELECT count(*) n FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s',
                (ws,q.run.id)).fetchone()['n']==1
    finally:
        assert native_rows(context,q.run.id)==native
        assert target_fixture.material(context)==before
        target_fixture.assert_human_unchanged(context,human)


@pytest.mark.parametrize('damage',['provider_revoke','tool_revoke','stale_fence','access',
    'receipt_binding','cross_conversation','attachment_hash'])
def test_full_tool_retained_read_denial_has_no_receipt_or_effect(context,tmp_path,damage):
    s,p,ws,_,admin=context
    q,grant,human,fake,args,events,steps,native,before=capture(context,tmp_path,
        'attachment' if damage=='attachment_hash' else 'checkpoint',
        foreign=damage=='cross_conversation',bad_attachment=damage=='attachment_hash')
    if damage=='stale_fence':args['cap']=replace(args['cap'],fence=args['cap'].fence+1)
    elif damage=='receipt_binding':args['receipt']=replace(args['receipt'],request_hash='0'*64)
    elif damage in ('provider_revoke','tool_revoke','access'):
        with Database(admin).transaction() as c:
            if damage=='provider_revoke':
                c.execute('UPDATE provider_grants SET active=false WHERE id=(SELECT grant_id FROM provider_attempts WHERE workspace_id=%s AND run_id=%s)',(ws,q.run.id))
            elif damage=='tool_revoke':c.execute('UPDATE tool_grants SET active=false WHERE id=%s',(grant.id,))
            else:c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
    calls=list(fake.calls)
    with pytest.raises(DomainError) as denied:s.stage_general_product(**args)
    # A blanket classification error is not proof of access/fence/binding denial.
    frames=[]
    tb=denied.value.__traceback__
    while tb is not None:
        frames.append(tb.tb_frame.f_code)
        tb=tb.tb_next
    diagnostic={'damage':damage,'code':denied.value.code.value,
                'frames':[(f.co_filename.rsplit('/',1)[-1],f.co_name) for f in frames]}
    if damage=='provider_revoke':
        from workagent.provider_attempts import check_grant
        assert denied.value.code.value=='action_unresolved',diagnostic
        assert check_grant.__code__ in frames,diagnostic
    else:
        assert denied.value.code.value in ('not_found_or_not_authorized','source_changed'),diagnostic
    assert journal(s,ws,q.run.id)==events and requests(s,ws,q.run.id)==steps
    assert native_rows(context,q.run.id)==native
    assert target_fixture.material(context)==before and fake.calls==calls
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()


def test_full_tool_schema_admits_retained_read_dtos_offline():
    _,schema=contract(SimpleNamespace(**config('off')['responses']))
    for decision in [dict(kind='read_result',run_id='prior-run',phase='selection_5',operation_hash='a'*64,offset=0,limit=8192),
                     dict(kind='read_attachment',message_id='message',ref='attachment',sha256='b'*64,offset=0,limit=8192)]:
        value=schema.model.model_validate_json(json.dumps(dict(goal='Read exact retained evidence',success_criteria=[],decision=decision)))
        assert value.decision.model_dump(mode='json')==decision
