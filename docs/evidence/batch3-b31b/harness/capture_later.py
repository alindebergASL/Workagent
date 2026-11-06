"""Capture actual production-worker requests after UI mutations; synthetic model only."""
import json, os, sys
from pathlib import Path
from unittest.mock import patch
from workagent.db import Database
from workagent.service import Service, Principal
from workagent.operator_client import OperatorClient
from test_domain import cmd
from test_memory_parent_worker import activated
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from workagent.models import SourceRef, PostMessage

def capture(ws,cid,label):
    s=Service(Database());p=Principal('local-human');client=OperatorClient()
    ctx=(s,p,ws,[],os.environ['MIGRATION_DATABASE_URL'])
    cv=s.get_conversation(p,ws,cid).conversation
    # Synthetic-only authority is installed in this disposable fixture; no product transport.
    out=Path.cwd().parent/'evidence'/'later';out.mkdir(exist_ok=True)
    marker=out/(cid+'-synthetic-grant.json')
    if not marker.exists():
        # The fixture enforces one active grant per principal/workspace. Retire
        # only this proof's completed synthetic grant before another UI journey.
        from workagent.provider_attempts import revoke_grant
        with s.db.transaction() as c:
            old=c.execute('SELECT id,data FROM provider_grants WHERE workspace_id=%s AND principal_id=%s AND active',(ws,p.id)).fetchone()
            if old:
                assert old['data']['responses']['transport_mode']=='synthetic'
                assert not c.execute("SELECT 1 FROM runs WHERE workspace_id=%s AND data->>'state' NOT IN ('ready','cancelled','failed','partial')",(ws,)).fetchone()
        if old: revoke_grant(Database(os.environ['MIGRATION_DATABASE_URL']),old['id'])
        grant=activated(ctx,cv)
        marker.write_text(json.dumps({'grant_id':grant.id,'conversation_id':cid,'transport':'synthetic'})+'\n')
    current=client.request('/'+ws+'/conversations/'+cid)['conversation']
    body=cmd(PostMessage,expected_work_version=current['work_version'],text='Prepare the next ordinary project summary using currently eligible memory').model_dump(mode='json')
    posted=client.request('/'+ws+'/conversations/'+cid+'/messages',body)
    run=posted['run']['id']
    provider=AlphaProvider([{'kind':'reply','text':'Controlled transport completed this later request; not a live quality result.'}])
    out=Path.cwd().parent/'evidence'/'later';out.mkdir(exist_ok=True)
    w=worker(ctx,provider,out)
    result=finish_safe_visits(ctx,w,run);assert result.state=='ready'
    page=s.list_memory(p,ws,cid)
    expected=[x.revision.revision_id for x in page.items]
    assert provider.contexts and [e['revision_id'] for e in provider.contexts[0]['memory_manifest']]==expected
    usages=client.request('/'+ws+'/runs/'+run+'/memory-usage')
    assert usages['items']
    with s.db.transaction() as c:
        for u in usages['items']:
            row=c.execute('SELECT request_sha256 FROM responses_steps WHERE attempt_id=%s AND phase=%s',(u['attempt_id'],u['phase'])).fetchone()
            assert row['request_sha256']==u['request_sha256']
            assert [e['revision_id'] for e in u['entries']]==expected
    evidence=dict(evidence='real HTTP + production worker + restricted PG, controlled transport, zero paid calls',
        conversation_id=cid,run_id=run,expected_revisions=expected,usage=usages,
        memory_context=provider.contexts[0]['memory_context'],memory_manifest=provider.contexts[0]['memory_manifest'])
    (out/(label+'.json')).write_text(json.dumps(evidence,indent=2)+'\n')
    return evidence
if __name__=='__main__':
    result=capture(*sys.argv[1:4]);print('Later request bound usage PASS',result['run_id'],result['expected_revisions'])
