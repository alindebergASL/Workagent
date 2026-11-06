"""Parent actual TCP/restricted-PG procedural lifecycle and adversarial controls."""
from concurrent.futures import ThreadPoolExecutor
import copy
import json
from test_workspace_files_parent_http import tcp, checked, command, create_work, create_file, read_file
from test_domain import context
from workagent.db import Database


def test_parent_procedure_tcp_lifecycle_race_restart_and_revoke(tcp):
    client,ctx,start,stop,tmp=tcp
    s,p,ws,refs,owner=ctx;root=f'/v1/workspaces/{ws}';cv=create_work(client,ws)
    original='Human note stays exact: 雪\r\nDo not overwrite this annotation.\n'
    file=create_file(client,ws,cv,original)
    from test_memory_parent_worker import activated
    activated(ctx,s.get_conversation(p,ws,cv['id']).conversation)
    message=checked(client.post(root+'/conversations/'+cv['id']+'/messages',json=command(
        expected_work_version=cv['work_version'],text='Correction: missing values are not zero. Check current units and use the valid unique denominator.')),202)
    options=checked(client.get(root+'/memory/lesson-evidence',params={'conversation_id':cv['id']}))
    evidence=next(i['evidence'] for i in options['items'] if i['evidence']['event_id']==message['message']['id'])
    fields=dict(kind='procedure',scope_kind='task',scope_id=cv['id'],subject_key='analysis',predicate_key='units',
        content='Check current units and unique valid denominator before aggregating.',
        applicability='Duration summaries with identified records.',confidence_basis='One observed human correction; transfer remains to be evaluated.',
        source_refs=[dict(source_type='file',ref=file['current'])],
        procedure=dict(retrieval_terms=['duration'],excluded_terms=['raw row count'],counterexamples=['Missing is not zero; explicit row counts use rows.'],
                       evidence=[evidence],validation_notes='Actual correction message; no causal learning evidence.'))
    candidate=checked(client.post(root+'/memory/candidates',json=command(**fields)),201)
    endpoint=root+'/memory/'+candidate['memory_id']
    assert candidate['status']=='candidate'
    assert not checked(client.get(root+'/memory',params={'conversation_id':cv['id']}))['items']
    bad=copy.deepcopy(fields);bad['procedure']['evidence'][0]['sha256']='0'*64
    assert client.post(root+'/memory/candidates',json=command(**bad)).status_code in (404,409,422)
    assert client.post(root+'/memory/candidates',json=command(**fields,origin='human_reviewed',status='active')).status_code==422
    # A document-shaped "command" cannot grant authority through the closed DTO.
    assert client.post(root+'/memory/candidates',json=command(**fields,reviewed_by_principal_id=p.id)).status_code==422
    adopted=checked(client.post(endpoint+'/review',json=command(expected_revision_id=candidate['revision_id'],decision='accept')))
    assert adopted['status']=='active'
    def correct(i):
        return client.post(endpoint+'/correct',json=command(expected_revision_id=adopted['revision_id'],content='Human revised denominator check '+str(i),mode='permanent'))
    with ThreadPoolExecutor(max_workers=2) as pool:race=list(pool.map(correct,[1,2]))
    assert sorted(r.status_code for r in race)==[200,409]
    current=checked(client.get(endpoint))['current']
    assert current['source_refs']==fields['source_refs'] and current['procedure']==fields['procedure']
    rollback=command(expected_revision_id=current['revision_id'],target_revision_id=adopted['revision_id'])
    restored=checked(client.post(endpoint+'/rollback',json=rollback))
    assert restored['revision_id'] not in (current['revision_id'],adopted['revision_id'])
    assert checked(client.post(endpoint+'/rollback',json=rollback))==restored
    assert checked(client.get(endpoint))['current']['content']==fields['content']
    assert client.post(endpoint+'/rollback',json=command(expected_revision_id=restored['revision_id'],target_revision_id=candidate['revision_id'])).status_code in (404,409,422)
    assert checked(read_file(client,ws,file))['text']==original
    stop();start()
    inspection=checked(client.get(endpoint));assert inspection['current']['revision_id']==restored['revision_id']
    assert len(inspection['revisions'])==4
    assert checked(read_file(client,ws,file))['text']==original
    with Database(owner).transaction() as c:
        c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
    assert client.get(endpoint).status_code==404
    assert client.get(root+'/memory/lesson-evidence',params={'conversation_id':cv['id']}).status_code==404
    assert client.post(endpoint+'/rollback',json=command(expected_revision_id=restored['revision_id'],target_revision_id=adopted['revision_id'])).status_code==404
    (tmp/'procedure-tcp.json').write_text(json.dumps(dict(actual_tcp=True,restricted_pg=True,paid_calls=0,race=[200,409],history_versions=4,replay=True,restart=True,human_file_exact=True,revocation=True),indent=2))
