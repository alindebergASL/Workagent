"""Closed builtin classification; PG cases are parent-run on the fixed fixture."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import psycopg
import pytest

from test_timing_recovery import context
from test_retained_read_gateway_pg import capture, native_rows, PHASE
from test_gateway_target_rejection import material
from test_local_rejection_settlement import journal, requests
from test_general_responses import worker
from retained_read_visits import finish_natural_visits
from workagent.composition import (ReadDecision, ReadSavedWork, DiscoverSavedWork,
    SearchWorkContext, RecordResponsibility, AdvanceResponsibility, ReadContext,
    InspectJSON, FetchPublicURL, DiscoverCapabilities, LoadSkill)
from workagent.retained_results import ReadResult, ReadAttachment
from workagent.product_models import PublishArtifact, ReconcileCSV, RunWasm
from workagent.products import is_builtin_operation
from workagent.capabilities import registry
from workagent.db import Database, migrate
from workagent.responses_ledger import Ledger


BUILTINS=(ReadResult, ReadAttachment, ReadSavedWork, DiscoverSavedWork,
          SearchWorkContext, RecordResponsibility, AdvanceResponsibility)
KINDS=('read_result','read_attachment','read_saved_work','discover_saved_work',
       'search_work_context','record_responsibility','advance_responsibility')
MIGRATION=Path(__file__).resolve().parents[1]/'migrations/080_builtin_operation_classification.sql'
OLD="OR NEW.data->'decision'->>'kind' NOT IN ('reply','stop',"
NEW=OLD+','.join(repr(kind) for kind in KINDS)+','
PREDECESSOR='15638668e2384d8a151b193762d69d9ff52b2e7624d2f2d76d90a08ff55a6567'


@pytest.mark.parametrize('model',BUILTINS,ids=lambda model:model.__name__)
def test_exact_builtin_class_only_offline(model):
    # Classification only: model_construct deliberately grants no validity or
    # authority. Actual staging must first resolve the authenticated selection.
    assert is_builtin_operation(model.model_construct())
    derived=type('UnreviewedSubclass',(model,),{})
    assert not is_builtin_operation(derived.model_construct())


def test_gateway_legacy_terminal_unknown_classes_not_exempt_offline():
    from workagent.general_schema import Reply
    from workagent.adaptive import Stop
    for model in (ReadDecision,ReadContext,InspectJSON,FetchPublicURL,
            DiscoverCapabilities,LoadSkill,PublishArtifact,ReconcileCSV,RunWasm,Reply,Stop):
        assert not is_builtin_operation(model.model_construct())
    for adapter in registry.adapters().values():
        assert not is_builtin_operation(adapter.input_model.model_construct())
    assert not is_builtin_operation(None)  # Existing require_operation handles None.
    for kind in KINDS:
        assert not is_builtin_operation(SimpleNamespace(kind=kind))
    assert not is_builtin_operation(SimpleNamespace(kind='unknown'))


def definitions(c):
    return {row['name']:row['definition'] for row in c.execute(
        "SELECT p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition "
        "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
        "WHERE n.nspname='public' AND p.prokind='f' ORDER BY 1").fetchall()}


def test_080_exact_delta_rollback_drift_runtime_ddl_and_migrate_retry(context):
    """Parent-only: validates then installs080 on the hard-pinned disposable DB."""
    s,_,_,_,admin=context
    sql=MIGRATION.read_text()
    with Database(admin).transaction() as c:
        before=definitions(c)
        current=before['guard_tool_consumption()']
        original=current.replace(NEW,OLD) if NEW in current else current
        assert sha256(original.encode()).hexdigest()==PREDECESSOR
        assert original.count(OLD)==1
        expected=original.replace(OLD,NEW)
        with c.transaction(force_rollback=True):
            c.execute(original)
            baseline=definitions(c)
            with c.transaction(force_rollback=True):
                c.execute(sql)
                assert definitions(c)==dict(baseline,**{'guard_tool_consumption()':expected})
                # Direct reapplication fails closed; journal retry is tested below.
                with pytest.raises(psycopg.errors.RaiseException,match='predecessor drift'),c.transaction():
                    c.execute(sql)
            assert definitions(c)==baseline
            c.execute(original.replace('DECLARE r runs;', '-- unrelated drift\nDECLARE r runs;',1))
            drifted=definitions(c)
            with pytest.raises(psycopg.errors.RaiseException,match='predecessor drift'),c.transaction():
                c.execute(sql)
            assert definitions(c)==drifted
        assert definitions(c)==before
    with pytest.raises(psycopg.errors.InsufficientPrivilege),s.db.transaction() as c:
        c.execute(original)
    migrate(admin)
    with Database(admin).transaction() as c:
        installed=definitions(c)
        assert installed==dict(before,**{'guard_tool_consumption()':expected})
        history=c.execute('SELECT * FROM schema_migrations ORDER BY name').fetchall()
        assert history[-1]['name']==MIGRATION.name
        assert history[-1]['checksum']==sha256(MIGRATION.read_bytes()).hexdigest()
    migrate(admin)
    with Database(admin).transaction() as c:
        assert definitions(c)==installed
        assert c.execute('SELECT * FROM schema_migrations ORDER BY name').fetchall()==history


@pytest.mark.parametrize('forgery',list(KINDS)+['unknown','binding','material','adapter_observation'])
def test_builtin_classification_keeps_exact_sql_receipt_guards(context,tmp_path,forgery):
    s,_,ws,_,_=context
    q,_,_,fake,args,events,_,native,before=capture(context,tmp_path,'checkpoint')
    trusted={}
    original=Ledger.event
    def stop(self,c,phase,kind,data):
        if phase==PHASE and kind=='tool_result':
            trusted.update(deepcopy(data))
            raise InterruptedError('trusted range receipt before stage INSERT')
        return original(self,c,phase,kind,data)
    with patch.object(Ledger,'event',stop):
        with pytest.raises(InterruptedError,match='trusted range receipt'):
            s.stage_general_product(**args)
    assert trusted['decision']['kind']=='read_result'
    ledger=Ledger(s,args['receipt'])
    with s.db.transaction() as c:
        reads=c.execute('SELECT * FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s',
            (ws,q.run.id)).fetchall()
        assert len(reads)==1
        # Real SQL positive control, including every dedicated guard, rolls back.
        with c.transaction(force_rollback=True):ledger.event(c,PHASE,'tool_result',trusted)
    bad=deepcopy(trusted)
    if forgery in KINDS or forgery=='unknown':
        bad['decision']['kind']=forgery
        bad['capability_result']['capability']=forgery
        if forgery=='read_result':bad['decision']['operation_hash']='0'*64
    elif forgery=='binding':bad['binding']['selection_request_sha256']='0'*64
    elif forgery=='material':bad['body']={'title':'Forged material'}
    else:bad['capability_result']['capability']='files_read_range'
    calls=list(fake.calls)
    with pytest.raises(psycopg.Error) as denied,s.db.transaction() as c:
        ledger.event(c,PHASE,'tool_result',bad)
    assert 'operation not installed in capability gateway' not in str(denied.value)
    assert journal(s,ws,q.run.id)==events
    assert native_rows(context,q.run.id)==native
    assert material(context)==before and fake.calls==calls
    with s.db.transaction() as c:
        assert c.execute('SELECT * FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s',
            (ws,q.run.id)).fetchall()==reads


def test_prepared_next_validates_builtin_history_without_restaging(context,tmp_path):
    s,_,ws,_,_=context
    q,_,_,fake,args,_,_,native,before=capture(context,tmp_path,'checkpoint')
    s.stage_general_product(**args)
    reserve=Ledger.reserve_operation
    def pause(self,request,kind,cap,**kw):
        if request.phase=='selection_3' and kind=='count_send':
            raise InterruptedError('next request prepared before count')
        return reserve(self,request,kind,cap,**kw)
    with patch.object(Ledger,'reserve_operation',pause):
        with pytest.raises(InterruptedError,match='next request prepared'):
            finish_natural_visits(context,worker(context,fake,tmp_path),q.run.id)
    steps=requests(s,ws,q.run.id)
    events=journal(s,ws,q.run.id)
    assert 'selection_3' in steps and ('selection_3','count_send') not in events
    stage=s.stage_general_product
    def no_restage(cap,receipt,phase='selection'):
        assert phase not in ('selection',PHASE), 'prepared history was restaged'
        return stage(cap,receipt,phase)
    with patch.object(s,'stage_general_product',no_restage):
        assert finish_natural_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    after=journal(s,ws,q.run.id)
    assert all(after[k]==v for k,v in events.items())
    assert all(requests(s,ws,q.run.id)[k]==v for k,v in steps.items())
    assert native_rows(context,q.run.id)==native and material(context)==before
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM retained_result_reads WHERE workspace_id=%s AND run_id=%s',
            (ws,q.run.id)).fetchone()['n']==1
