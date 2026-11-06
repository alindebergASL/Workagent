"""Narrow R1 restricted-PG/API and R2 native durable rejection regressions."""
import copy
import secrets
import pytest
from fastapi.testclient import TestClient
from test_domain import context, cmd
from test_home_work_summary import artifact, proposal
from test_workspace_files_pg import make, text
from test_tui_files import controller, FilesHTTP
from workagent.api import Settings, create_app
from workagent.db import Database
from workagent.models import new_id
from workagent.workspace_file_models import CreateWorkspaceFile, ProposeFilePatch
from workagent.operator_journal import DomainRejection, OperatorError


def test_private_file_aliases_filtered_before_counts_and_pagination(context):
    s,p,ws,_,admin=context
    cv,file,_=make(context)
    ordinary,rev=artifact(context,cv)
    visible_proposal=proposal(context,cv,ordinary,rev,new_id())
    # Exceed both inherited projection bounds: hidden rows cannot affect counts.
    hidden=[file.workspace_file_id]
    for i in range(21):
        f=s.create_workspace_file(p,ws,cv.id,cmd(CreateWorkspaceFile,
            expected_work_version=cv.work_version,source=text('private '+str(i))))
        hidden.append(f.workspace_file_id)
        s.propose_file_patch(p,ws,f.workspace_file_id,cmd(ProposeFilePatch,
            expected_work_version=cv.work_version,base_version_id=f.current.version_id,
            base_sha256=f.current.sha256,content='patch',sha256=__import__('hashlib').sha256(b'patch').hexdigest(),reason='private'))
    other='member-'+new_id()
    with Database(admin).transaction() as c:
        c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,%s,'editor')",(ws,other))
    with s.db.transaction() as c:
        role=c.execute('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()
        assert not role['rolsuper'] and not role['rolbypassrls']
    token=secrets.token_urlsafe(32)
    headers={'Authorization':'Bearer '+token,'X-Schema-Version':'workagent/v1','X-Request-Id':new_id()}
    root=f'/v1/workspaces/{ws}'
    with TestClient(create_app(Settings(s.db.dsn,True,token,other))) as client:
        def get(path):
            r=client.get(root+path,headers=headers)
            assert r.status_code==200,r.text
            assert all(h not in r.text for h in hidden)
            return r.json()
        assert get(f'/conversations/{cv.id}')['artifact_ids']==[ordinary]
        page=get('/conversation-work?limit=1')
        assert [x['artifact_id'] for x in page['items']]==[ordinary]
        assert not page['has_more'] and page['next_cursor'] is None
        area=get(f'/conversations/{cv.id}/work-context')
        assert [x['artifact_id'] for x in area['artifacts']]==[ordinary]
        assert [x['proposal_id'] for x in area['proposals']]==[visible_proposal.id]
        assert area['omissions']['artifacts']==area['omissions']['proposals']==0
        # Event/snapshot endpoints remain owner-only; do not widen them to
        # exercise the SQL defense in depth. Prove denial and the SQL predicate.
        for suffix in ('work-snapshot','attention','events'):
            assert client.get(root+f'/{suffix}?conversation_id={cv.id}',headers=headers).status_code==404
        with s.db.transaction() as c:
            assert c.execute('SELECT work_artifact_visible(%s,%s,%s,%s) AS visible',
                (ws,other,cv.id,ordinary)).fetchone()['visible']
            assert not c.execute('SELECT work_artifact_visible(%s,%s,%s,%s) AS visible',
                (ws,other,cv.id,file.workspace_file_id)).fetchone()['visible']
        for path in (f'/artifacts/{file.workspace_file_id}',f'/work-areas/{cv.id}/files',
                     f'/files/{file.workspace_file_id}/versions/{file.current.version_id}?sha256={file.current.sha256}'):
            assert client.get(root+path,headers=headers).status_code==404
        assert get(f'/artifacts/{ordinary}')['id']==ordinary
    assert len(s.get_conversation(p,ws,cv.id).artifact_ids)==len(hidden)+1


class RejectingFilesHTTP(FilesHTTP):
    mode='reject'
    def request(self,path,body=None):
        if body is not None and self.mode!='success':
            self.posts.append((path,copy.deepcopy(body)))
            if self.mode=='unknown':
                raise OperatorError('ambiguous transport failure')
            raise DomainRejection(dict(status=409,response=dict(code='version_conflict',
                message='Stale version',request_id=body['request_id'] if self.mode!='mismatch' else 'wrong',
                next_action='Refresh',details={})))
        return super().request(path,body)


def prepared(tmp_path):
    c=controller(tmp_path,RejectingFilesHTTP());c.refresh();c.open_file(c.page.items[0])
    c.session.edit(content='human unsent 雪',base={**c.session.draft['base'],'normalize':True})
    base=copy.deepcopy(c.session.draft['base']);envelope=c.prepare('save')
    return c,base,envelope


def test_definitive_rejection_restart_explicit_reprepare_preserves_exact_base(tmp_path):
    c,base,envelope=prepared(tmp_path)
    with pytest.raises(DomainRejection):c.send()
    c=controller(tmp_path,c.client)
    assert c.session.draft['pending']['state']=='rejected'
    c.client.version=4
    with pytest.raises(OperatorError):c.prepare('save')
    c.resolve_rejection()
    c=controller(tmp_path,c.client)
    assert c.session.draft['content']=='human unsent 雪' and c.session.draft['base']==base
    history=c.session.state['drafts']['rejected:'+envelope['body']['command_id']]
    assert history['pending']['state']=='rejected' and history['pending']['body']==envelope['body']
    c.refresh();new=c.prepare('save')
    assert new['body']['command_id']!=envelope['body']['command_id']
    assert new['body']['expected_work_version']==4
    assert new['body']['base_version_id']==envelope['body']['base_version_id']
    assert new['body']['base_sha256']==envelope['body']['base_sha256']
    c.client.mode='success';c.send()
    assert c.session.draft['content']=='human unsent 雪'


@pytest.mark.parametrize('first',['unknown','mismatch','legacy'])
def test_ambiguous_or_unmatched_rejection_never_unlocks_on_later_rejection(tmp_path,first):
    c,base,envelope=prepared(tmp_path)
    if first=='legacy':
        legacy=copy.deepcopy(envelope);legacy.pop('state');c.session.edit(pending=legacy)
    else:
        c.client.mode=first
        with pytest.raises(OperatorError):c.send()
    c=controller(tmp_path,c.client);c.client.mode='reject'
    with pytest.raises(DomainRejection):c.send()
    c=controller(tmp_path,c.client)
    assert c.session.draft['pending']['state']=='outcome_unknown'
    c.client.version=5;c.refresh()
    with pytest.raises(OperatorError,match='unknown outcome'):c.resolve_rejection()
    with pytest.raises(OperatorError,match='pending'):c.prepare('save')
    assert c.session.draft['base']==base and c.session.draft['content']=='human unsent 雪'
    assert c.session.draft['pending']['body']==envelope['body']
