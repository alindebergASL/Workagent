"""Pure actual material/read/discovery paths; authorization leaf doubles, no PG."""
from copy import deepcopy
from types import SimpleNamespace as NS
import pytest
from workagent import retained_results as R
from workagent.errors import DomainError
from workagent.service import digest

TARGET={'artifact_id':'target','revision_id':'revision','body_hash':'a'*64}
SECRET='UNSUPPORTED_NESTED_BODY_MUST_NOT_ESCAPE'

def decision(**kw):
    return R.ReadResult.model_validate(dict(kind='read_result',run_id='old-run',phase='selection_3',operation_hash='b'*64,offset=0,limit=8192)|kw)

def nested():
    return {'status':'reply','decision':dict(kind='read_result',run_id='earlier',phase='selection_5',operation_hash='c'*64,offset=0,limit=8192),
            'binding':{'operation_hash':'b'*64},'capability_result':{'capability':'read_result','version':'1','result':{'status':'available','text':SECRET}}}

class Connection:
    def __init__(self,event=None):self.event=event;self.calls=[];self.saved=None;self.inserts=0
    def execute(self,sql,args):
        self.calls.append(sql)
        if sql.startswith('SELECT data FROM retained_result_reads'):value=self.saved
        elif sql.startswith('SELECT count(*)'):value={'pages':self.inserts,'bytes':0}
        elif sql.startswith('INSERT INTO retained_result_reads'):
            self.saved={'data':args[-1].obj};self.inserts+=1;value=None
        elif 'FROM run_checkpoints' in sql:value=None
        elif 'FROM responses_events' in sql:value={'data':self.event} if self.event else None
        else:raise AssertionError(sql)
        return NS(fetchone=lambda:value)

def scope(monkeypatch,event=None,target=TARGET):
    called=[]
    def auth(*args):called.append('authorize');return NS(target=NS(model_dump=lambda **kw:target) if target else None)
    monkeypatch.setattr(R,'authorize',auth)
    monkeypatch.setattr(R,'projection_version',lambda *args:R.LEGACY_PROJECTION)
    return Connection(nested() if event is None else event),NS(workspace_id='w',id='current'),called


def test_targeted_read_of_read_is_body_free_unavailable_and_exact_restart(monkeypatch):
    c,run,calls=scope(monkeypatch);original=deepcopy(c.event)
    first=R.read(None,c,None,run,None,decision(),'selection_4',{'exact':'binding'})
    assert first=={'capability':'read_result','version':'1','result':{'status':'unavailable'}}
    assert R.read(None,c,None,run,None,decision(),'selection_4',{'exact':'binding'})==first
    assert c.inserts==1 and len(calls)==2 and c.event==original
    assert SECRET not in str(c.saved) and c.saved['data']['projection_version']=='legacy-v1'
    with pytest.raises(DomainError) as denied:R.read(None,c,None,run,None,decision(offset=1),'selection_4',{'exact':'binding'})
    assert denied.value.code.value=='command_conflict' and c.inserts==1


@pytest.mark.parametrize('code',['not_found_or_not_authorized','source_changed','action_unresolved'])
def test_current_source_authority_denials_never_become_unavailable(monkeypatch,code):
    c,run,_=scope(monkeypatch)
    def deny(*args):raise DomainError(code)
    monkeypatch.setattr(R,'authorize',deny)
    with pytest.raises(DomainError) as denied:R.read(None,c,None,run,None,decision(),'selection_4',{})
    assert denied.value.code.value==code and c.inserts==0
    assert not any('FROM responses_events' in sql for sql in c.calls)


def test_supported_outside_target_still_denies(monkeypatch):
    event=nested();event['decision']={'kind':'read_context','section':'work_area'}
    event['capability_result']={'capability':'read_context','result':{'value':SECRET}}
    c,run,_=scope(monkeypatch,event)
    with pytest.raises(DomainError):R.material(None,c,None,run,None,decision())
    assert c.inserts==0


def test_unsupported_selected_target_revalidation_is_preserved(monkeypatch):
    import workagent.general_responses as G
    event=nested();event['decision']['target']=TARGET
    c,run,_=scope(monkeypatch,event)
    def reject(*args):raise DomainError('source_changed')
    monkeypatch.setattr(G,'exact_target',reject)
    with pytest.raises(DomainError) as denied:R.material(None,c,None,run,None,decision())
    assert denied.value.code.value=='source_changed'


def test_missing_exact_reference_has_no_body_and_supported_target_stays_exact(monkeypatch):
    c,run,_=scope(monkeypatch);c.event=None
    assert R.material(None,c,None,run,None,decision()) is None
    c.event={'status':'reply','decision':{'kind':'read_context','section':'target'},
             'capability_result':{'capability':'read_context','result':{'value':'authorized body'}}}
    assert R.material(None,c,None,run,None,decision())==b'{"value":"authorized body"}'


def test_reference_discovery_omits_unsupported_receipts_without_reading_bodies(monkeypatch):
    keys=[('selection','1'*64),('selection_2','2'*64),('selection_3','3'*64),('selection_4','4'*64)]
    cp={'run_id':'old-run','phase':'selection_4','checkpoint_hash':'9'*64,'data':{'steps':[dict(phase=p,operation_hash=h) for p,h in keys]}}
    metadata=[dict(phase=p,operation_hash=h,status='reply',kind=k,section=None,target=None,capability=k)
              for (p,h),k in zip(keys,['files_read_range','read_result','read_attachment','reply'])]
    class C:
        calls=[]
        def execute(self,sql,args):
            self.calls.append(sql)
            if 'FROM run_checkpoints' in sql:return NS(fetchall=lambda:[cp,cp])
            assert "e.data->'capability_result'->>'capability'" in sql and 'text' not in sql
            return NS(fetchall=lambda:metadata)
    c=C();monkeypatch.setattr(R,'authorize',lambda *a:NS(target=NS(model_dump=lambda **kw:TARGET)))
    refs=R.references(None,c,None,NS(workspace_id='w'),NS(id='cv'))
    assert refs==[dict(run_id='old-run',phase='selection_4',operation_hash='9'*64),dict(run_id='old-run',phase='selection',operation_hash='1'*64)]
    def denied(*args):raise DomainError('not_found_or_not_authorized')
    monkeypatch.setattr(R,'authorize',denied);c.calls=[]
    assert R.references(None,c,None,NS(workspace_id='w'),NS(id='cv'))==[]
    assert len(c.calls)==1  # No event metadata query after denial.


def test_additive_sql_splice_preserves_all_predecessor_guards():
    import re
    from pathlib import Path
    root=Path(__file__).parents[1]
    sql=(root/'migrations/085_retained_unavailable.sql').read_text()
    old=(root/'migrations/048_run_checkpoints.sql').read_text().split('CREATE FUNCTION retained_result_material(',1)[1].split('CREATE FUNCTION guard_retained_result_read()',1)[0]
    needle=re.search(r'needle=\$q\$(.*?)\$q\$;',sql,re.S).group(1)
    addition=re.search(r'EXECUTE replace\(definition,needle,\$q\$(.*?)\$q\$\|\|needle\)',sql,re.S).group(1)
    assert old.count(needle)==1
    new=old.replace(needle,addition+needle)
    assert new.replace(addition,'',1)==old
    assert new.index('retained selected revision changed')<new.index(addition)<new.index('retained result outside current target')
    assert "5e3294b30df594574dec58118a98ae1e1eb92b6bf170bc67eb8a005b70bb1092" in sql
    # Same support classification as the existing projection branches; no read recursion.
    for cap,section,status,supported in [('read_result',None,'reply',False),('read_attachment',None,'reply',False),('reply',None,'reply',False),('read_context','target','reply',True),('read_context','messages','reply',False),('read_saved_work',None,'reply',True),('inspect_json',None,'reply',True),('fetch_public_url',None,'reply',True),(None,None,'observed',True)]:
        assert R._legacy_projection_supported(cap,section,status)==supported
    assert 'read_result' not in addition and 'RETURN NULL' in addition
