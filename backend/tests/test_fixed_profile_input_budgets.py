"""New defaults fit 50k reservations; old fixed caps remain exact and enforceable."""
import json
import pytest
import psycopg
from pydantic import TypeAdapter,ValidationError
from test_domain import context
from test_responses_worker import grant as intake_grant
from workagent.models import ResponsesBinding,GeneralResponsesBinding,AdaptiveResponsesBinding,ProviderGrant,new_id
from workagent.db import Database
from workagent.provider_attempts import configure_grant
from workagent.service import encoded


@pytest.mark.parametrize('model,old,new',[(ResponsesBinding,80000,200000),(GeneralResponsesBinding,160000,400000),(AdaptiveResponsesBinding,1000000,2500000)])
def test_fixed_defaults_and_historical_values(model,old,new):
    field=model.model_fields['input_limit'];adapter=TypeAdapter(field.annotation)
    assert field.default==new
    assert adapter.validate_python(old)==old and adapter.validate_python(new)==new
    assert new==model.model_fields['generation_limit'].default*50000
    with pytest.raises(ValidationError):adapter.validate_python(new+1)


def test_legacy_intake_grant_is_not_enlarged_by_readback(context):
    s,p,ws,_,admin=context
    current=intake_grant(context)
    assert current.responses.input_limit==200000
    raw=current.model_dump(mode='json');raw['id']=new_id();raw['responses']['input_limit']=80000
    old=ProviderGrant.model_validate(raw)
    configured=configure_grant(Database(admin),old,predecessor_id=current.id)
    with s.db.transaction() as c:
        stored=c.execute('SELECT data FROM provider_grants WHERE id=%s',(old.id,)).fetchone()['data']
    assert configured.responses.input_limit==80000
    assert ProviderGrant.model_validate(stored).responses.input_limit==80000
    assert stored==old.model_dump(mode='json')


def test_direct_sql_cannot_install_unbounded_fixed_intake_input(context):
    s,p,ws,_,admin=context
    current=intake_grant(context)
    raw=current.model_dump(mode='json');raw['id']=new_id();raw['responses']['input_limit']=200001
    with pytest.raises(psycopg.Error,match='exact fixed intake input budget'):
        with Database(admin).transaction() as c:
            c.execute('INSERT INTO provider_grants(id,workspace_id,principal_id,data,active) VALUES (%s,%s,%s,%s,true)',
                (raw['id'],ws,p.id,encoded(raw)))
