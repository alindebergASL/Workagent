"""Final retained DOCX snapshots and opted-in file schema worker journey."""
from hashlib import sha256
from unittest.mock import patch
import pytest


@pytest.mark.parametrize('phase', ['selection', 'selection_2', 'selection_8'])
def test_file_schema_request_counting_uses_exact_opted_in_validator(phase):
    from workagent.capabilities.file_composition import POLICY, SCHEMA
    from workagent.responses_transport import build_tool_selection, RequestMetadata, TransportError
    request = build_tool_selection(instructions=POLICY, source_context='{}', read_schema=SCHEMA,
        metadata=RequestMetadata(request_id='file-schema-test', attempt_id='file-schema-test', step_id=phase),
        policy='adaptive-local-v1', phase=phase)
    assert request.count_body()
    # The new schema does not silently opt the non-adaptive transport into file tools.
    with pytest.raises(TransportError, match='schema_validator_mismatch'):
        build_tool_selection(instructions=POLICY, source_context='{}', read_schema=SCHEMA,
            metadata=RequestMetadata(request_id='file-schema-test', attempt_id='file-schema-test', step_id='selection'),
            policy='general-responses-v1').count_body()
from test_domain import context,cmd
from test_conversations import conversation,post
from test_document_journey_pg import ingest
from document_fixtures import docx
from workagent.workspace_file_models import CreateWorkspaceFile,DocumentEvidence,ExportFile
from workagent.service import Service


def test_docx_old_snapshot_refresh_restart_retains_original_bytes(context):
    s,p,ws,_,_=context;cv=conversation(context)
    detail,_,original=ingest(context,cv,docx('Original human annotation 雪'),'original.docx')
    first=s.create_workspace_file(p,ws,cv.id,cmd(CreateWorkspaceFile,expected_work_version=cv.work_version,
        source=DocumentEvidence(kind='document',document_id=detail.document_id,sha256=detail.sha256)))
    later,_,updated=ingest(context,cv,docx('Updated evidence with human annotation 雪'),'updated.docx')
    second=s.create_workspace_file(p,ws,cv.id,cmd(CreateWorkspaceFile,expected_work_version=cv.work_version,
        source=DocumentEvidence(kind='document',document_id=later.document_id,sha256=later.sha256),
        refresh_workspace_file_id=first.workspace_file_id,expected_version_id=first.current.version_id))
    assert second.current.version_id!=first.current.version_id
    fresh=Service(s.db)
    for f,d,raw in ((first,detail,original),(second,later,updated)):
        read=fresh.read_workspace_file(p,ws,f.workspace_file_id,f.current.version_id,f.current.sha256)
        assert read.text==d.text
        assert read.source_snapshot_id==f.current.version_id
        from workagent.source_snapshots import read as read_snapshot
        with fresh.db.transaction() as c:
            fresh._scope(c,p,ws)
            snapshot,_=read_snapshot(fresh,c,p,ws,f.current.version_id)
        assert snapshot.original_sha256==sha256(raw).hexdigest()
        assert snapshot.parser_version==d.parser_version
        assert snapshot.coverage==d.coverage
        assert fresh.download_document(p,ws,cv.id,d.document_id)[1]==raw
    assert snapshot.parent_snapshot_id==first.current.version_id


@pytest.mark.parametrize('restart', [False, True, 'before_stage', 'human_edit'])
def test_opted_in_file_schema_real_worker_stage_and_checkpoint(context,tmp_path,restart):
    from test_general_alpha_runtime import activate,AlphaProvider
    from test_general_responses import worker
    from test_adaptive_execution import finish_safe_visits
    from workagent.capabilities.file_composition import POLICY,SCHEMA
    from workagent.capabilities import registry,policy
    from workagent.capabilities.models import ToolGrantV1,CapabilityPin
    from workagent.db import Database
    from workagent.models import new_id,now
    from datetime import timedelta
    s,p,ws,_,admin=context;cv=conversation(context)
    with patch('test_general_alpha_runtime.POLICY',POLICY),patch('test_general_alpha_runtime.DECISION_SCHEMA',SCHEMA):
        activate(context,cv,continuity_version='sustained-v1',max_steps=3)
    queued=post(context,cv,'Create a local text draft and report what was retained.')
    descriptor=registry.adapters()['files.create_draft'].descriptor
    grant=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=queued.run.id,scope_id=cv.id,
        capabilities=[CapabilityPin(id=descriptor.id,version=descriptor.version,schema_sha256=descriptor.schema_sha256,
            implementation_sha256=descriptor.implementation_sha256)],resource_selectors=[],effects=descriptor.effects,
        privacy_classes=['workspace_private'],egress='none',expires_at=now()+timedelta(hours=1),
        access_generation=queued.run.access_generation,budget_account_id=new_id())
    policy.install(Database(admin),grant,limits={'local_compute':5})
    text='Synthetic gateway draft; human annotation stays visible.'
    fake=AlphaProvider([dict(kind='files_create_draft',source=dict(kind='text',filename='journey.txt',mime_type='text/plain',content=text,sha256=sha256(text.encode()).hexdigest())),dict(kind='reply',text='Saved a draft; it is not accepted work.')])
    if restart:
        def crash_after_observation(name):
            if name=='after_tool_result':
                raise SystemExit('Controlled process stop after durable tool result')
        if restart=='before_stage':
            from workagent.capabilities.broker import execute_composition
            def observed_before_stage(*args, **kwargs):
                execute_composition(*args, **kwargs)
                raise SystemExit('Controlled process stop before provider stage')
            with patch('workagent.capabilities.broker.execute_composition', observed_before_stage), pytest.raises(SystemExit):
                worker(context,fake,tmp_path).work(p,ws,queued.run.id)
        else:
            with pytest.raises(SystemExit):
                worker(context,fake,tmp_path,hook=crash_after_observation).work(p,ws,queued.run.id)
        assert len(s.list_workspace_files(p,ws,cv.id).items)==1
        if restart=='human_edit':
            from workagent.workspace_file_models import EditWorkspaceFile
            from workagent.errors import DomainError
            f=s.list_workspace_files(p,ws,cv.id).items[0]
            changed='Human correction must fence the worker'
            edited=s.edit_workspace_file(p,ws,f.workspace_file_id,cmd(EditWorkspaceFile,
                expected_work_version=s.get_conversation(p,ws,cv.id).conversation.work_version,
                base_version_id=f.current.version_id,base_sha256=f.current.sha256,
                content=changed,sha256=sha256(changed.encode()).hexdigest()))
            calls=list(fake.calls)
            with pytest.raises(DomainError) as error:
                worker(context,fake,tmp_path).work(p,ws,queued.run.id)
            assert error.value.code.value in ('source_changed','version_conflict')
            assert fake.calls==calls
            assert len(s.list_workspace_files(p,ws,cv.id).items)==1
            assert s.read_workspace_file(p,ws,f.workspace_file_id,edited.current.version_id,edited.current.sha256).text==changed
            assert not any(m.author_kind=='assistant' for m in s.get_conversation(p,ws,cv.id).messages)
            return
        from test_runtime import expire
        expire(context,queued.run.id)
    result=finish_safe_visits(context,worker(context,fake,tmp_path),queued.run.id)
    assert result.state=='ready'
    files=s.list_workspace_files(p,ws,cv.id).items;assert len(files)==1
    f=files[0];assert s.read_workspace_file(p,ws,f.workspace_file_id,f.current.version_id,f.current.sha256).text==text
    with s.db.transaction() as c:
        attempts=c.execute("SELECT e.data FROM tool_attempts a JOIN tool_attempt_events e "
            "ON e.attempt_id=a.id AND e.kind='observation' WHERE a.workspace_id=%s AND a.run_id=%s",
            (ws,queued.run.id)).fetchall()
        assert len(attempts)==1 and attempts[0]['data']['status']=='observed'
        assert c.execute('SELECT 1 FROM run_checkpoints WHERE workspace_id=%s AND run_id=%s',(ws,queued.run.id)).fetchone()
        events=c.execute("SELECT e.data FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s AND a.run_id=%s AND e.kind='tool_result'",(ws,queued.run.id)).fetchall()
        assert events
    calls=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,queued.run.id).state=='ready'
    assert fake.calls==calls
