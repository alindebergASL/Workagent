"""Cheap actual installer and exact additive SQL invariants; never connects PG."""
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import json
import re
import pytest
from workagent.capabilities import implementation_releases as impl,registry
ROOT=Path(__file__).resolve().parents[2]

@pytest.mark.parametrize('resolved',[True,False])
def test_install_requires_exact_computed_cohort(resolved):
    from workagent.capabilities.file_adapters import adapters
    d=adapters()['files.list'].descriptor
    grant=dict(id='g',workspace_id='w',run_id='r',active=True,data={'capabilities':[{'id':d.id}]})
    calls=[]
    class C:
        def execute(self,sql,args):
            calls.append((sql,args));self.row=grant if 'SELECT * FROM tool_grants' in sql else {'d':d.model_dump(mode='json') if resolved else None} if 'tool_implementation_descriptor' in sql else {'ok':True};return self
        def fetchone(self):return self.row
    c=C()
    class DB:
        @contextmanager
        def transaction(self):yield c
    identity=dict(source_sha256='a'*64,consumer_sha256='b'*64)
    with patch.object(impl,'execution_identity',return_value=identity),patch.object(impl,'_owner'),patch.object(impl,'_binding'),patch.object(registry,'adapters',return_value={d.id:SimpleNamespace(descriptor=d)}):
        if resolved:assert impl.install_transition(DB(),['g'],amendment_sha256='c'*64,predecessor_source_sha256='d'*64)==identity
        else:
            with pytest.raises(ValueError,match='exact complete installed source transition required'):impl.install_transition(DB(),['g'],amendment_sha256='c'*64,predecessor_source_sha256='d'*64)
    assert ('g',d.id,'a'*64,'b'*64) in [a for s,a in calls if 'tool_implementation_descriptor' in s]
    if not resolved:assert not any('tool_run_available' in s for s,a in calls)


def test083_preserves_insert_invariant_and_all_eight_exact_splices():
    original=(ROOT/'backend/migrations/081_capability_implementation_releases.sql').read_text()
    text=(ROOT/'backend/migrations/083_source_cohorts_file_envelope.sql').read_text()
    assert 'NEW.predecessor_installation_sha256 IS DISTINCT FROM tool_json_hash(old_descriptor)' in original
    assert 'tool_json_hash(old_descriptor)' not in text
    assert text.count('IF (length(definition)-length(replace(definition,old,\'\')))<>length(old)')==8
    assert text.count('pg_get_functiondef(\'public.')>=9
    assert text.count('NOT public.tool_call_payload_size_allowed(payload)')==2
    assert 'CREATE TABLE' not in text and not re.search(r'^\s*(INSERT|UPDATE|DELETE)\s',text,re.M)
    for check in ('source_sha256=selected_source','source IS DISTINCT FROM b.source_sha256',"descriptor-'implementation_sha256'",'clock_timestamp()','AND enabled'):
        assert check in text
    assert 'SET statement_timeout' not in text and 'SET LOCAL statement_timeout' not in text


def test_frozen_source_and_release_plan_recompute():
    base=ROOT/'.local/batch3/b35c/retained-read-recovery/implementation-44'
    plan=json.loads((base/'RELEASE_PLAN.json').read_text())
    assert impl.execution_identity()==plan['identity']
    for name,row in plan['releases'].items():
        d=registry.adapters()[name].descriptor.model_dump(mode='json')
        assert row==dict(release_sha256=impl.release_id(d,plan['identity']),**impl.release_record(d,plan['identity']))


def test_successor_guard_only_extends_exact_pin_predicate():
    text=(ROOT/'backend/migrations/083_source_cohorts_file_envelope.sql').read_text()
    original=(ROOT/'backend/migrations/081_capability_implementation_releases.sql').read_text()
    block=text.split('DO $successor$',1)[1].split('END $successor$;',1)[0]
    needle=block.split('$needle$')[1];replacement=block.split('$replacement$')[1]
    assert original.count(needle)==1
    assert "prior_release.descriptor->>'implementation_sha256'=pin->>'implementation_sha256'" not in replacement
    for term in ('prior_binding.grant_id=NEW.grant_id','prior_binding.capability_id=NEW.capability_id',
                 'prior_binding.source_sha256=NEW.predecessor_source_sha256',
                 'prior_binding.predecessor_pin=pin','prior_release.enabled',
                 'prior_binding.predecessor_installation_sha256=NEW.predecessor_installation_sha256',
                 'NEW.predecessor_source_sha256,prior_binding.consumer_sha256)=prior_release.descriptor'):
        assert term in replacement
    new=original.replace(needle,replacement)
    assert new.replace(replacement,needle)==original
    assert 'NEW.predecessor_installation_sha256 IS DISTINCT FROM tool_json_hash(old_descriptor)' in new
    assert "TG_OP='DELETE'" in new and "NEW.binding_id IS DISTINCT FROM tool_json_hash" in new
