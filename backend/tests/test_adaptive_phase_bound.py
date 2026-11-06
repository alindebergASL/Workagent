"""No-network ordinal and immutable exhausted-prefix recovery regressions."""
from copy import deepcopy
from types import SimpleNamespace as NS
import pytest
from workagent import adaptive, general_responses, file_input_rejection
from workagent.errors import DomainError
from test_durable_boundary_resume import chain,cursor,Rows


@pytest.mark.parametrize('gap',['selection_rejection','file_input_rejection'])
def test_final_ordinal_includes_rejection_phases(monkeypatch,gap):
    # Both real rejection families deliberately have no tool_result metadata.
    prior=[dict(phase='selection',verification=dict(request={'message':'bound'}))]
    monkeypatch.setattr(adaptive,'retained',lambda *a:deepcopy(prior))
    monkeypatch.setattr(adaptive,'request_provenance',lambda *a:{'message':'bound'})
    monkeypatch.setattr(adaptive,'verify',lambda *a,**k:dict(satisfied=False))
    value=adaptive.AdaptiveDecision(goal='Exact goal',success_criteria=[],decision=dict(kind='reply',text='not used'))
    staged=dict(status='observed',capability_result={'retained':True})
    result=adaptive.stage_metadata(None,NS(receipt=NS(attempt_id='attempt')),'selection_3',value,
        NS(kind='files_list'),staged,3,NS(acceptance_checks=None),alpha=True,continuity=True)
    assert result['terminal_outcome']=='step_limit',gap
    assert result['goal']=='Exact goal' and result['success_criteria']==[]


def test_historical_bound_continue_cursor_keeps_exact_receipts(monkeypatch):
    from workagent.composition import DECISION_SCHEMA
    monkeypatch.setattr(adaptive,'DECISION_SCHEMA',DECISION_SCHEMA)
    f=chain(monkeypatch,count=8);before=deepcopy((f.rows,f.events))
    request,index,settled=cursor(f)
    assert index==8 and settled[1]['terminal_outcome']=='continue'
    assert request.body==f.rows[-1]['request_bytes'].encode() and (f.rows,f.events)==before


@pytest.mark.parametrize('phase,bound',[('selection_1',8),('selection_03',8),('selection_9',8),
    ('final',8),('selection_-1',8),('selection_3x',8),('selection',True),('selection',0)])
def test_forged_ordinal_denied_before_metadata(monkeypatch,phase,bound):
    with pytest.raises(DomainError,match='command_conflict'):adaptive.phase_ordinal(phase,bound)


def exhausted(monkeypatch):
    from workagent.composition import DECISION_SCHEMA
    from contextlib import contextmanager
    from workagent import run_checkpoints,outcomes
    monkeypatch.setattr(adaptive,'DECISION_SCHEMA',DECISION_SCHEMA)
    f=chain(monkeypatch,count=8)
    run=NS(id='run',workspace_id='ws',state='running',stop_reason=None,used_units=0,lease_expires_at='current',execution=NS())
    tx=f.w.service.db.transaction
    class Conn:
        def __init__(self,c):self.c=c
        def execute(self,sql,args=None):
            if 'require_general_publication_authority' in sql:
                f.checks.append('publication_authority');return Rows([])
            return self.c.execute(sql,args)
    @contextmanager
    def transaction():
        with tx() as c:yield Conn(c)
    f.w.service.db.transaction=transaction
    f.w.service._check_capability=lambda *a:(None,run,NS(id='cv'))
    f.w.service._validate_general_context=lambda *a:f.checks.append('context')
    monkeypatch.setattr(general_responses,'check_pins',lambda *a:f.config)
    monkeypatch.setattr(file_input_rejection,'tools_unresolved',lambda *a:False)
    f.w.service._store_run=lambda c,r:f.checks.append('store')
    f.w.service._event=lambda *a:f.checks.append('audit')
    monkeypatch.setattr(run_checkpoints,'record',lambda *a:f.checks.append('checkpoint'))
    monkeypatch.setattr(outcomes,'acknowledge',lambda *a:f.checks.append('ack'))
    f.w._terminal_readback=lambda p,ws,r:r
    f.run=run
    return f


@pytest.mark.parametrize('damage',[None,'revoked','stale','context','native_unknown','native_cost_only','late_unknown','ordinal'])
def test_actual_restart_bound_stop_or_deny_without_replay(monkeypatch,damage):
    from workagent.models import ProviderGrant
    f=exhausted(monkeypatch);before=deepcopy((f.rows,f.events))
    monkeypatch.setattr(ProviderGrant,'model_validate',lambda *a:NS(responses=None))
    monkeypatch.setattr(adaptive,'contract',lambda _:(adaptive.POLICY,adaptive.DECISION_SCHEMA))
    monkeypatch.setattr(adaptive,'stage_product',lambda *a:pytest.fail('old stage replay'))
    f.w.phases=NS(_step=lambda *a:pytest.fail('old provider I/O'),_hook=lambda *a:None)
    f.ledger.snapshot=lambda *a:(None,{})
    f.ledger.prepare=lambda *a:pytest.fail('replacement prepare')
    if damage=='revoked':monkeypatch.setattr(general_responses,'resolve_selection',lambda *a:(_ for _ in ()).throw(DomainError('not_found_or_not_authorized')))
    elif damage=='stale':f.w.service._check_capability=lambda *a:(_ for _ in ()).throw(DomainError('not_found_or_not_authorized'))
    elif damage=='context':f.w.service._validate_general_context=lambda *a:(_ for _ in ()).throw(DomainError('source_changed'))
    elif damage in ('native_unknown','native_cost_only'):f.native.append(dict(data=dict(status=damage[7:])))
    elif damage=='late_unknown':monkeypatch.setattr(file_input_rejection,'tools_unresolved',lambda *a:True)
    elif damage=='ordinal':f.rows[-1]['phase']='selection_9';before=deepcopy((f.rows,f.events))
    call=lambda:f.w._adaptive_work(None,'ws',f.run,f.cap,f.ledger.receipt,f.ledger,None,f.config,999,resume_final=False)
    if damage:
        with pytest.raises(DomainError):call()
        assert 'store' not in f.checks and 'ack' not in f.checks
    else:
        result=call()
        assert result.state=='partial' and result.stop_reason=='step_limit' and result.used_units==1
        assert 'incomplete' in result.unresolved[0]
        assert f.checks[-6:]==['context','publication_authority','store','checkpoint','audit','ack']
        assert f.checks.count('store')==f.checks.count('checkpoint')==f.checks.count('ack')==1
    assert (f.rows,f.events)==before


def test_sql_successor_splice_retains_every_other_predecessor_guard():
    import re
    from pathlib import Path
    root=Path(__file__).resolve().parents[1]
    sql=(root/'migrations/086_bounded_phase_stop.sql').read_text()
    old=(root/'migrations/048_run_checkpoints.sql').read_text().split('CREATE FUNCTION require_run_successor(',1)[1].split('-- Admission is an explicit terminal-boundary',1)[0]
    needle=re.search(r'needle text=\$q\$(.*?)\$q\$;',sql,re.S).group(1)
    replacement=re.search(r'EXECUTE replace\(definition,needle,\$q\$(.*?)\$q\$\)',sql,re.S).group(1)
    assert old.count(needle)==1
    amended=old.replace(needle,replacement)
    assert amended.replace(replacement,needle)==old
    assert 'AND NOT bounded_phase_stop_settled(pa.id)' in amended
    # Later extensions only broaden the supported schema-hash list here.
    for number in (50,55,57,58,59,61,63,65,68,84):
        paths=list((root/'migrations').glob(f'{number:03d}_*.sql'));assert len(paths)==1
        text=paths[0].read_text();assert needle not in text
    for guard in ('file_input_tools_unresolved','obs.attempt_id IS NULL','cp.checkpoint_hash','step.request_sha256',
                  'step.count_sha256',"'selection_rejection'","file_input_rejection_valid", "'continue_slice'"):
        assert guard in sql


@pytest.mark.parametrize('settled,state,denied',[(True,'partial',False),(False,'partial',True),(True,'running',True)])
def test_admission_only_exact_sql_bound_settlement_exception(monkeypatch,settled,state,denied):
    class C:
        def execute(self,sql,args=None):
            if 'SELECT id FROM runs' in sql:return Rows([])
            if 'SELECT a.id' in sql:return Rows([dict(id='attempt',run_state=state)])
            if 'bounded_phase_stop_settled' in sql:return Rows([dict(settled=settled)])
            raise AssertionError(sql)
    monkeypatch.setattr(general_responses,'cancelled_rejection_is_settled',lambda *a:False)
    assert general_responses.has_unresolved_attempt(C(),'ws','cv')==denied


@pytest.mark.parametrize('gap',['selection_rejection','file_input_rejection'])
def test_pg_fixture_actual_models_and_provider_choices_offline(monkeypatch,gap):
    import test_adaptive_phase_bound_pg as P
    from workagent.capabilities.file_composition import GatewayFilesDecision
    from workagent.capabilities.file_adapters import FilesProposePatch,FilesCreateDraft,ArtifactsExport
    from pydantic import ValidationError
    from hashlib import sha256
    content='Human content é\r\n';digest=sha256(content.encode()).hexdigest()
    human=NS(id='human',current_revision_id='revision',current_revision=NS(body=NS(content=content,content_sha256=digest)))
    cv=NS(id='cv');q=NS(run=NS(id='run',access_generation=1))
    service=NS(get_artifact=lambda *a:human,get_conversation=lambda *a:NS(conversation=cv))
    ctx=(service,NS(id='person'),'ws',None,'synthetic-no-connect')
    monkeypatch.setattr(P,'make',lambda ctx:(cv,NS(workspace_file_id='human'),None))
    monkeypatch.setattr(P,'activated',lambda *a:NS(id='provider'))
    monkeypatch.setattr(P,'post',lambda *a:q)
    captured=[];monkeypatch.setattr(P.policy,'install',lambda db,g,**kwargs:captured.append((g,kwargs)))
    _,grant,_,fake=P.fixture(ctx,gap)
    assert grant.resource_selectors[0].id=='human' and grant.allow_run_outputs
    assert captured[0][1]['provider_grant_id']=='provider' and len(captured[0][1]['amendment_sha256'])==64
    if gap=='selection_rejection':
        with pytest.raises(ValidationError):FilesCreateDraft.model_validate(fake.decisions[0])
    else:
        d=FilesProposePatch.model_validate(fake.decisions[0]);assert d.sha256!=sha256(d.content.encode()).hexdigest()
    assert FilesCreateDraft.model_validate(fake.decisions[1]).source.content==P.CONTENT
    ref=dict(kind='workspace_file',id='new',version='newversion',sha256='1'*64)
    assert ArtifactsExport.model_validate(fake.decisions[2]({'run_output_refs':[ref]})).input_ref.id=='new'
