"""Production worker + restricted disposable DB, controlled HTTP (not live quality)."""
from copy import deepcopy
from test_domain import context,cmd
from test_work_area_context import saved
from test_general_alpha_runtime import activate,AlphaProvider
from test_general_responses import worker,target
from test_adaptive_execution import finish_safe_visits
from workagent.models import PostMessage
from workagent.service import canonical


def test_current_document_once_and_exact_journal_survives_restart(context,tmp_path):
    s,p,ws,_,_=context
    cv,art=saved(context);activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,
        text='Keep this current document intact and inspect the scoped details.',target=target(art)))
    def choose(ctx):
        assert ctx['target_body']['body']==art.current_revision.body.model_dump(mode='json')
        item=ctx['work_area_context']['artifacts'][0]
        assert item['body']['body_reference']['path']=='#/target_body/body'
        return {'kind':'read_context','section':'work_area'}
    def answer(ctx):
        result=ctx['adaptive']['observations'][0]['capability_result']['result']
        assert result['section']=='work_area'
        assert result['value']['artifacts'][0]['body']['body_reference']['path']=='#/target_body/body'
        # Human/history prose is intentionally not string-deduplicated; only
        # identical structured bodies are referenced.
        return {'kind':'reply','text':'Scoped full details inspected; saved document unchanged.'}
    fake=AlphaProvider([choose,answer]);w=worker(context,fake,tmp_path)
    assert finish_safe_visits(context,w,q.run.id).state=='ready'
    with s.db.transaction() as c:
        before=c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['data']
    assert before['work_area_context']['artifacts'][0]['body']==art.current_revision.body.model_dump(mode='json')
    calls=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    assert fake.calls==calls
    assert s.get_artifact(p,ws,art.id).current_revision_id==art.current_revision_id


def test_inactive_handover_retrieval_cannot_expose_another_conversation(context,tmp_path):
    from test_responsibilities import delegate,activate as activate_lifecycle,plan
    from workagent.responsibility_models import UpdateResponsibility,ResponsibilityWait
    s,p,ws,_,_=context
    cv,art=saved(context);foreign_cv,foreign_art=saved(context)
    a=delegate(context,cv);detail=activate_lifecycle(context,a,artifact=art)
    foreign=delegate(context,foreign_cv);activate_lifecycle(context,foreign,artifact=foreign_art)
    long_outcome='Retained handover detail. '*100
    s.update_responsibility(p,ws,a.id,cmd(UpdateResponsibility,
        expected_work_version=detail.assignment.work_version,
        **plan(artifact=art,current_outcome=long_outcome,
               wait=ResponsibilityWait(kind='person',reason='A human decision is still required.'))))
    cv=s.get_conversation(p,ws,cv.id).conversation
    activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,
        text='Inspect the saved handover. Do not resume it or change any work.'))
    def choose(ctx):
        items=ctx['work_area_context']['responsibilities']
        assert [item['assignment_id'] for item in items]==[a.id]
        assert items[0]['lifecycle'] is None and items[0]['lifecycle_omitted']
        return {'kind':'read_context','section':'work_area'}
    def answer(ctx):
        result=ctx['adaptive']['observations'][0]['capability_result']['result']['value']
        items=result['responsibilities']
        assert [item['assignment_id'] for item in items]==[a.id]
        assert items[0]['lifecycle']['current_outcome']==long_outcome
        assert foreign.id not in canonical(result)
        return {'kind':'reply','text':'The handover is still waiting for the human decision.'}
    fake=AlphaProvider([choose,answer])
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    assert s.get_work_area_context(p,ws,cv.id).responsibilities[0].lifecycle.current_outcome==long_outcome


def test_already_prepared_old_schema_restores_exact_bytes(context,tmp_path,monkeypatch):
    from test_alpha_budget import prepared
    import workagent.request_packing as packing
    from workagent.composition import LEGACY_DECISION_SCHEMA
    original=packing.prepare_selection
    def historical(*args,**kwargs):
        kwargs['read_schema']=LEGACY_DECISION_SCHEMA
        return original(*args,**kwargs)
    with monkeypatch.context() as change:
        change.setattr(packing,'prepare_selection',historical)
        _,fake,x=prepared(context,tmp_path)
    before=x['request'].body
    restored,events=x['ledger'].snapshot('selection',x['cap'])
    assert restored.body==before and restored.sha256==x['request'].sha256
    assert restored.schema==LEGACY_DECISION_SCHEMA
    assert restored.count_body()==x['request'].count_body()
    assert fake.calls==[] and events=={}
