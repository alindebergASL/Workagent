"""Route evidence binds facts, never a rolling 24-hour execution lease."""
import json
from copy import deepcopy
from datetime import datetime,timedelta,timezone
from types import SimpleNamespace
import pytest
from workagent.responses_dispatcher import current_route_authority
from workagent.responses_transport import TransportError


def fixture():
    runtime={'model':'gpt-6.1-sol','profile':'general-responses-v1',
             'product_project_id':'synthetic-project','secure_secret_reference':'synthetic-reference'}
    from workagent.general_responses import AUTHORIZATION_HASH
    verification={'checked_at':datetime.now(timezone.utc).isoformat(),'model':'gpt-6.1-sol',
        'official_origin':'https://api.openai.com','account_available':True,'model_available':True,
        'synthetic_context_confirmed':True,'service_tier':'default','store_acknowledged':True,
        'input_usd_per_million':'2.5','output_usd_per_million':'10','authorization_sha256':AUTHORIZATION_HASH}
    grant=SimpleNamespace(id='synthetic-grant',responses=SimpleNamespace(project_id='synthetic-project',secret_reference='synthetic-reference'))
    return {'grant_id':grant.id,'runtime':runtime,'verification':verification},grant


def test_stale_evidence_remains_valid_without_timestamp_renewal(tmp_path,monkeypatch):
    import workagent.models as rules
    record,grant=fixture();path=tmp_path/'route.json';path.write_text(json.dumps(record))
    start=datetime.fromisoformat(record['verification']['checked_at'])
    monkeypatch.setattr(rules,'now',lambda:start+timedelta(hours=25))
    assert current_route_authority(path,grant,record['runtime'])==record
    assert json.loads(path.read_text())==record  # runtime never renews the evidence itself


@pytest.mark.parametrize('damage',['project','secret','grant','model','malformed','missing'])
def test_reload_never_rebinds_runtime_or_accepts_unavailable_evidence(tmp_path,damage):
    record,grant=fixture();expected=deepcopy(record['runtime']);path=tmp_path/'route.json'
    if damage=='project':record['runtime']['product_project_id']='other-project'
    elif damage=='secret':record['runtime']['secure_secret_reference']='other-reference'
    elif damage=='grant':record['grant_id']='other-grant'
    elif damage=='model':record['runtime']['model']='other-model'
    path.write_text('{' if damage=='malformed' else json.dumps(record))
    if damage=='missing':path.unlink()
    with pytest.raises(TransportError):current_route_authority(path,grant,expected)
