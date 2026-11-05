"""Pure integrated model-discovery checks. No database/provider/install access.

Storage doubles are explicit: these test Python routing and material/authority
contracts, not PostgreSQL trigger execution. Parent owns the serial SQL proof.
"""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
from types import SimpleNamespace as NS
from uuid import UUID

import pytest
from pydantic import ValidationError
from workagent import model_discovery as md, retained_results as rr, work_context as wc
from workagent.discovery_composition import SCHEMA, POLICY, GatewayDiscoveryDecision, enabled
from workagent.errors import DomainError
from workagent.service import canonical

ROOT = Path(__file__).resolve().parents[2]


class Result:
    def __init__(self, rows): self.rows = rows
    def fetchone(self): return self.rows[0] if self.rows else None
    def fetchall(self): return self.rows


class Store:
    def __init__(self):
        self.receipts = []; self.rows = []; self.messages = {}; self.checkpoints = {}
        self.scope = {'run': 'run', 'principal': 'owner', 'generation': 1, 'context': ['other']}
        self.scans = 0
    def execute(self, sql, args=()):
        sql = sql.replace("public.", "")
        if sql.startswith('SELECT model_discovery_scope_v2'): return Result([{'scope': deepcopy(self.scope)}])
        if sql.startswith('SELECT * FROM model_discovery_candidates_v2'):
            self.scans += 1
            pos = deepcopy(args[3].obj)
            index = 0 if pos is None else next(i+1 for i, row in enumerate(self.rows) if row['position'] == pos)
            return Result(self.rows[index:index+args[4]])
        if sql.startswith('INSERT INTO model_discovery_receipts_v2'):
            row = dict(zip(('id','workspace_id','run_id','phase','decision','binding','scope','position','result'), args))
            for key in ('decision','binding','scope','position','result'): row[key] = deepcopy(row[key].obj)
            self.receipts.append(row); return Result([])
        if 'FROM model_discovery_receipts_v2' in sql:
            if 'WHERE id=%s' in sql:
                return Result([r for r in self.receipts if (r['id'],r['workspace_id'],r['run_id']) == args])
            rows = [r for r in self.receipts if (r['workspace_id'],r['run_id']) == args[:2]]
            if 'phase=%s' in sql: rows = [r for r in rows if r['phase'] == args[2]]
            if "decision->>'kind'=" in sql: rows = [r for r in rows if r['decision']['kind'] == 'search_work_context_page']
            return Result(rows)
        if 'FROM conversation_messages' in sql:
            value = self.messages.get(args[2]); return Result([{'data': value}] if value else [])
        if 'FROM run_checkpoints' in sql:
            value = self.checkpoints.get(args[1]); return Result([value] if value else [])
        raise AssertionError(sql)


@pytest.fixture
def env(monkeypatch):
    from workagent import general_responses, provider_attempts
    c = Store()
    config = {'grant_id': 'grant', 'responses': {'continuity_version': 'sustained-v1',
        'scope_tool_sha256': sha256(SCHEMA.material).hexdigest(), 'runtime_extension': 'general-alpha-v1'}}
    p = NS(id='owner'); run = NS(id='run', workspace_id='ws', conversation_id='current', principal_id='owner', access_generation=1)
    cv = NS(id='current')
    other = NS(id='other', owner_id='owner', selected_source_refs=[], state='open', work_version=1, title='Other', work_area=None)
    checked = []
    service = NS(_scope=lambda *a: 1, _runtime_pins=lambda *a: checked.append('runtime'),
        _owned_conversation=lambda *a: cv, _conversation=lambda *a: other)
    monkeypatch.setattr(general_responses, 'check_pins', lambda *a: config)
    monkeypatch.setattr(provider_attempts, 'check_grant', lambda *a: checked.append('grant'))
    def authorized(*a):
        source = a[-1]
        checked.append(source)
        if source.startswith('denied'): raise DomainError('not_found_or_not_authorized')
        return NS(target=None)
    monkeypatch.setattr(rr, 'authorize', authorized)
    # Exercise the unchanged retained.material checkpoint branch, including its
    # canonical bytes, without manufacturing a database acceptance claim.
    from workagent import run_checkpoints
    monkeypatch.setattr(run_checkpoints, 'read_row', lambda row: NS(data=row['data']))
    return NS(c=c, config=config, p=p, run=run, cv=cv, service=service, other=other, checked=checked)


def retained_rows(env, denied=70):
    for i in range(denied+1):
        rid = ('denied-' if i < denied else 'old-authorized-') + str(i)
        ref = dict(run_id=rid, phase='selection', operation_hash='a'*64)
        env.c.rows.append({'position': ['2026-01-01T00:00:00+00:00', f'private-checkpoint-{i}', 1], 'candidate': ref})
        env.c.checkpoints[rid] = {'data': {'goal': 'historical checkpoint', 'steps': []}}


def call(env, decision, phase='selection', binding=None):
    return md.execute(env.service, env.c, env.p, env.run, env.cv, env.config, decision, phase,
                      binding or {'attempt_id': 'attempt', 'operation_hash': 'b'*64})


def retained(cursor=None, limit=12):
    return md.DiscoverRetainedReferences(kind='discover_retained_references', cursor=cursor, limit=limit)


def search(cursor=None, query='needle', limit=6):
    return md.SearchWorkContextPage(kind='search_work_context_page', cursor=cursor, query=query, limit=limit)


def work_rows(env, count=80):
    for i in range(count):
        key = f'message-{i:04}'
        env.c.rows.append({'position':['other','human_message',key],
            'candidate':dict(conversation_id='other',kind='human_message',record_id=key)})
        env.c.messages[key] = dict(text='needle outside frozen summary' if i == count-1 else 'unrelated',created_at='2026-01-01T00:00:00+00:00')


def test_denied_prefix_opaque_continuation_reaches_old_checkpoint(env):
    retained_rows(env)
    first = call(env, retained())['result']
    assert first['items'] == [] and first['has_more']
    assert UUID(first['next_cursor']).version == 4
    assert 'denied' not in canonical(first) and 'private-checkpoint' not in canonical(first)
    second = call(env, retained(first['next_cursor']), 'selection_2')['result']
    assert not second['has_more'] and second['next_cursor'] is None
    item, = second['items']
    assert item['run_id'] == 'old-authorized-70'
    assert item['projection_version'] == 'legacy-v1'
    raw = canonical({'goal':'historical checkpoint','steps':[]}).encode()
    assert item['body_sha256'] == sha256(raw).hexdigest() and item['body_bytes'] == len(raw)
    assert env.c.scans == 2 and 'grant' in env.checked and 'runtime' in env.checked


def test_reachable_work_outside_frozen_summary_and_empty_packing(env):
    work_rows(env)
    frozen = {'items': [{'record_id':'original-summary'}], 'truncated':True}
    original = deepcopy(frozen)
    context = {'work_context_index':frozen,'retained_results':[]}
    md.project_catalog(context)
    context.pop('work_context_index'); context.pop('retained_results')
    from workagent.composition import _discover
    names = {d['name'] for d in _discover(None, context)['capabilities']}
    assert {'discover_retained_references','search_work_context_page'} <= names
    first = call(env, search())['result']
    assert first['items'] == [] and first['has_more']
    second = call(env, search(first['next_cursor']), 'selection_2')['result']
    hit, = second['items']
    assert hit['source']['record_id'] == 'message-0079'
    assert hit['excerpt'] == 'needle outside frozen summary'
    assert hit['source']['content_sha256'] == sha256(hit['excerpt'].encode()).hexdigest()
    assert not second['has_more'] and frozen == original
    # No invocation of the old index, and no mutation of its original selection.


@pytest.mark.parametrize('change', ['scope','query','limit','run','forged'])
def test_cursor_scope_query_and_identity_change_refused(env, change):
    work_rows(env)
    token = call(env, search())['result']['next_cursor']
    if change == 'scope': env.c.scope['context'] = ['different']
    if change == 'run': env.run.id = 'different'
    if change == 'forged': token = '00000000-0000-4000-8000-000000000000'
    choice = search(token, query='different' if change == 'query' else 'needle', limit=1 if change == 'limit' else 6)
    with pytest.raises(DomainError): call(env, choice, 'selection_2')
    assert len(env.c.receipts) == 1 and env.c.scans == 1


def test_scope_change_midscan_is_refused_before_retention(env, monkeypatch):
    work_rows(env, 1)
    original = md.project_candidate
    def changed(*args):
        item = original(*args); env.c.scope['generation'] = 2; return item
    monkeypatch.setattr(md, 'project_candidate', changed)
    with pytest.raises(DomainError): call(env, search())
    assert env.c.receipts == []


@pytest.mark.parametrize('failure', ['generation','principal','responsibility','old_schema','expired'])
def test_current_authority_fail_closed(env, monkeypatch, failure):
    from workagent import provider_attempts
    if failure == 'generation': env.service._scope = lambda *a: 2
    if failure == 'principal': env.run.principal_id = 'someone-else'
    if failure == 'responsibility': env.config['responsibility'] = {'assignment_id':'x'}
    if failure == 'old_schema': env.config['responses']['scope_tool_sha256'] = '0'*64
    if failure == 'expired':
        def expired(*a): raise DomainError('not_found_or_not_authorized')
        monkeypatch.setattr(provider_attempts, 'check_grant', expired)
    with pytest.raises(DomainError): call(env, search())
    assert env.c.scans == 0 and not env.c.receipts


def test_receipt_resume_no_rescan_or_duplicate_and_rechecks_content(env):
    work_rows(env,1)
    first = call(env,search())
    assert call(env,search()) == first
    assert env.c.scans == 1 and len(env.c.receipts) == 1
    env.c.messages['message-0000']['text'] = 'changed needle'
    with pytest.raises(DomainError): call(env,search())
    with pytest.raises(DomainError): md.authorize_selection(env.service,env.c,env.p,env.run,env.cv,env.config,search(),'selection')
    with pytest.raises(DomainError): md.validate_consumed(env.service,env.c,env.p,env.run,env.cv,env.config)


def test_retained_fast_stage_resume_reauthorizes_descriptor(env, monkeypatch):
    retained_rows(env,0); call(env,retained())
    def deny(*a): raise DomainError('not_found_or_not_authorized')
    monkeypatch.setattr(rr,'authorize',deny)
    with pytest.raises(DomainError): md.authorize_selection(env.service,env.c,env.p,env.run,env.cv,env.config,retained(),'selection')


def test_denied_work_has_no_metadata(env):
    work_rows(env,1); env.other.owner_id = 'other-owner'
    assert call(env,search())['result']['items'] == []


def test_programming_failures_not_masked_as_denials(env, monkeypatch):
    work_rows(env,1)
    def fail(*a): raise RuntimeError('bug')
    monkeypatch.setattr(wc,'_material',fail)
    with pytest.raises(RuntimeError): call(env,search())


@pytest.mark.parametrize('value', [0,13,True,'1'])
def test_strict_page_bounds(value):
    with pytest.raises(ValidationError): retained(limit=value)


@pytest.mark.parametrize('field,value', [('cursor','plaintext-denied-id'),('principal_id','owner'),('path','/private')])
def test_closed_cursor_and_no_authority_fields(field,value):
    with pytest.raises(ValidationError): md.DiscoverRetainedReferences.model_validate({**retained().model_dump(),field:value})


def test_new_schema_dispatch_classification_and_old_schema_material_unchanged():
    from workagent.adaptive import contract
    from workagent.products import is_builtin_operation
    from workagent.capabilities.delegation_composition import SCHEMA as OLD
    from workagent.responses_transport import build_tool_selection,RequestMetadata,_validate_request
    for choice in (retained(),search()):
        raw=dict(goal='discover',success_criteria=[],decision=choice.model_dump())
        assert type(GatewayDiscoveryDecision.model_validate(raw).decision) is type(choice)
        with pytest.raises(ValidationError): OLD.model.model_validate(raw)
        assert is_builtin_operation(choice)
        assert not is_builtin_operation(NS(kind=choice.kind))
        assert not is_builtin_operation(type('UnknownSubclass',(type(choice),),{}).model_construct())
    binding=NS(continuity_version='sustained-v1',scope_tool_sha256=sha256(SCHEMA.material).hexdigest())
    assert contract(binding) == (POLICY,SCHEMA)
    req=build_tool_selection(source_context=canonical({'messages':[]}),instructions=POLICY,read_schema=SCHEMA,
        metadata=RequestMetadata(request_id='run',attempt_id='attempt',step_id='selection'),policy='adaptive-local-v1')
    assert _validate_request(req)['tools'][0]['parameters'] == GatewayDiscoveryDecision.model_json_schema()
    assert canonical(json.loads((ROOT/'contracts/gateway-delegation-decision.schema.json').read_text())).encode() == OLD.material
    assert canonical(json.loads((ROOT/'contracts/sustained-decision.schema.json').read_text())).encode() == rr.SCHEMA.material
    sql=(ROOT/'backend/migrations/084_model_discovery_v2.sql').read_text()
    assert sha256(SCHEMA.material).hexdigest() in sql
    assert 'guard_work_context_search' not in sql
    assert 'UPDATE run_contexts' not in sql and 'ALTER TABLE retained_result_reads' not in sql


@pytest.mark.parametrize('family', ['retained', 'work'])
def test_real_product_dispatch_records_discovery_and_resume_does_not_rescan(env, monkeypatch, family):
    from contextlib import nullcontext
    from workagent.products import Products
    from workagent import general_responses, responses_ledger, adaptive, run_checkpoints
    from workagent.capabilities import policy
    choice=retained() if family=='retained' else search()
    if family=='retained': retained_rows(env,0)
    else: work_rows(env,1)
    binding={'attempt_id':'attempt','operation_hash':'b'*64}
    resolutions=[]; events={}; checkpoints=[]
    def resolve(*args):
        resolutions.append(True)
        md.authorize_selection(env.service,env.c,env.p,env.run,env.cv,env.config,choice,'selection')
        return env.p,env.run,env.cv,choice,None,binding,'synthetic'
    class Ledger:
        def __init__(self,*a): pass
        def _events(self,*a): return events
        def event(self,c,phase,kind,value): events[kind]=deepcopy(value)
    def not_adapter(*a): raise AssertionError('Discovery must not become an adapter/effect call')
    monkeypatch.setattr(general_responses,'resolve_selection',resolve)
    monkeypatch.setattr(responses_ledger,'Ledger',Ledger)
    monkeypatch.setattr(policy,'require_operation',not_adapter)
    # Exercise actual staging/receipt dispatch; budget metadata has its own test.
    monkeypatch.setattr(adaptive,'enabled',lambda *a:False)
    monkeypatch.setattr(run_checkpoints,'record',lambda *a:checkpoints.append(a[-1]))
    env.service.db=NS(transaction=lambda:nullcontext(env.c))
    env.service._publish_new_draft=lambda *a:None
    staged=Products.stage_general_product(env.service,object(),object())
    assert staged['capability_result']['capability']==choice.kind
    assert staged['capability_result']['version']=='2'
    assert staged['status']=='reply' and staged['body'] is None and staged['output'] is None
    assert Products.stage_general_product(env.service,object(),object())==staged
    assert env.c.scans==1 and len(env.c.receipts)==1 and checkpoints==['stage']
    assert len(resolutions)>=5


def test_step_budget_metadata_treats_discovery_as_read_not_completion(env,monkeypatch):
    from workagent import adaptive
    from workagent.adaptive import stage_metadata
    monkeypatch.setattr(adaptive,'retained',lambda *a:[])
    class Ledger:
        receipt=NS(attempt_id='attempt')
    chosen=GatewayDiscoveryDecision(goal='find context',success_criteria=[],decision=search())
    staged={'status':'reply','body':None,'output':None,'capability_result':{'capability':'search_work_context_page','version':'2','result':{'items':[]}}}
    from workagent.models import ConversationMessage
    message=ConversationMessage(id='message',conversation_id='current',run_id='run',sequence=1,
        author_id='owner',author_kind='human',text='find context',evidence_origin='human')
    metadata=stage_metadata(None,Ledger(),'selection',chosen,chosen.decision,staged,1,message,None,alpha=True,continuity=True)
    assert metadata['terminal_outcome']=='step_limit'
    assert not metadata['verification']['satisfied']


def test_legacy_receipt_without_projection_version_remains_exact_and_readable(env,monkeypatch):
    choice=rr.ReadResult(kind='read_result',run_id='old',phase='selection',operation_hash='a'*64,offset=0,limit=8192)
    raw=b'{"historical":"unchanged"}'
    original={'decision':choice.model_dump(mode='json'),'binding':{'operation_hash':'b'*64},
              'result':{'status':'available',**rr.page_bytes(raw,0,8192)}}
    before=deepcopy(original); versions=[]
    class Connection:
        def execute(self,sql,args):
            assert sql.startswith('SELECT data FROM retained_result_reads')
            return Result([{'data':original}])
    def material(*a,projection): versions.append(projection); return raw
    def no_reselection(*a): raise AssertionError('Old receipt cannot select a new projection')
    monkeypatch.setattr(rr,'material',material)
    monkeypatch.setattr(rr,'projection_version',no_reselection)
    result=rr.read(env.service,Connection(),env.p,env.run,env.cv,choice,'selection',original['binding'])
    assert result=={'capability':'read_result','version':'1','result':before['result']}
    assert original==before and versions==['legacy-v1']


def test_legacy_search_still_requires_and_uses_original_index(env):
    with pytest.raises(KeyError): wc.search(env.service,env.c,env.p,env.run,env.config,{},NS(query='needle',limit=6))
    context={'work_context_index':{'items':[],'truncated':True}}
    # No new discovery source is used by v1 even when live candidates exist.
    work_rows(env)
    from unittest.mock import patch
    with patch.object(wc,'permitted_conversations',return_value={'other'}):
        result=wc.search(env.service,env.c,env.p,env.run,env.config,context,NS(query='needle',limit=6))
    assert result['version']=='1' and result['result']['matches']==[] and env.c.scans==0
