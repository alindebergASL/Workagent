"""Offline production bootstrap controls; no database or provider."""
from unittest.mock import patch
import pytest
from workagent.capabilities import implementation_releases as R,registry

@pytest.mark.parametrize('case',['multiple','retry','partial','split_grants','disabled','absent','baseline','explicit'])
def test_current_release_evidence_is_one_complete_cohort(case):
    ds=[registry.adapters()[n].descriptor.model_dump(mode='json') for n in ('files.list','files.read_range')]
    identity=dict(source_sha256='a'*64,consumer_sha256='b'*64,dependencies={})
    g=dict(id='new',data={'capabilities':[{'id':d['id']} for d in ds]})
    def row(gid,amendment,eligible=True):return dict(grant_id=gid,amendment_sha256=amendment,eligible=eligible)
    rows=[[row('old-a','a'*64),row('old-b','b'*64)]]*2
    if case=='retry':rows=[[row('old-a','a'*64),row('new','b'*64)]]*2
    if case=='partial':rows=[rows[0],[]]
    if case=='split_grants':rows=[[row('one','a'*64)],[row('two','a'*64)]]
    if case=='disabled':rows=[[row('one','a'*64,False)]]*2
    if case in ('absent','baseline'):rows=[[],[]]
    class C:
        def __init__(self):self.calls=[];self.index=0
        def execute(self,sql,args):
            self.calls.append((sql,args))
            if 'SELECT * FROM tool_grants' in sql:self.value=g
            elif 'SELECT b.grant_id' in sql:
                assert args==(R.release_id(ds[self.index],identity),)
                self.value=rows[self.index];self.index+=1
                assert 'r.enabled' in sql and 'b.source_sha256=r.source_sha256' in sql
                assert 'b.consumer_sha256=r.consumer_sha256' in sql
                assert 'tool_implementation_descriptor' not in sql
                assert 'tool_grants' not in sql and 'expires_at' not in sql
            elif 'SELECT descriptor FROM capability_installations' in sql:
                d=next(d for d in ds if d['id']==args[0]);self.value={'descriptor':d if case=='baseline' else {**d,'implementation_sha256':'0'*64}}
            else:raise AssertionError(sql)
            return self
        def fetchone(self):return self.value
        def fetchall(self):return self.value
    c=C()
    with patch.object(R,'execution_identity',return_value=identity),patch.object(R,'_binding') as bind:
        if case in ('partial','split_grants','disabled','absent'):
            with pytest.raises(ValueError,match='complete current release approval required|approved release required'):R.bind_new_grant(c,g['id'])
            bind.assert_not_called()
        else:
            R.bind_new_grant(c,g['id'],amendment_sha256='e'*64 if case=='explicit' else None)
            if case=='baseline':bind.assert_not_called()
            else:
                expected=('e' if case=='explicit' else 'b' if case=='retry' else 'a')*64
                assert bind.call_count==2
                for call,d in zip(bind.call_args_list,ds):assert call.args==(c,g,d,identity,expected,None)
    if case=='explicit':assert c.index==0
