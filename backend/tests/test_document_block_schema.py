"""Provider grammar must express document invariants, not hide them in validators."""
import json
import pytest
from pydantic import ValidationError
from workagent.flexible_schema import DraftDocument
from workagent.flexible_models import Body
from workagent.composition import CONTINUITY_DECISION_SCHEMA


def exported_checkbox_types(schema, kind):
    # Inspect only the two field constraints implicated by the live failure,
    # not a replacement JSON Schema validator.
    items=schema['properties']['blocks']['items']
    branches=items.get('anyOf',[items])
    types=set()
    for branch in branches:
        definition=schema['$defs'][branch['$ref'].split('/')[-1]]
        props=definition['properties'];k=props['kind']
        if kind not in k.get('enum',[k.get('const')]):continue
        check=props['checked']
        types.update(x['type'] for x in check.get('anyOf',[check]))
    return types


@pytest.mark.parametrize('kind',['heading','paragraph','protected_note','checklist'])
@pytest.mark.parametrize('checked',[None,False,True])
def test_provider_schema_and_runtime_agree_on_checkbox_state(kind,checked):
    data={'title':'Synthetic opening checklist','blocks':[
        {'block_id':'opening','kind':kind,'text':'Confirm station coverage.','checked':checked}]}
    expected=kind=='checklist' or checked is None
    # The previous exported JSON schema accepted checked=False on paragraphs,
    # while Pydantic rejected it only after the paid response was generated.
    assert (('null' if checked is None else 'boolean') in exported_checkbox_types(DraftDocument.model_json_schema(),kind))==expected
    if expected:
        draft=DraftDocument.model_validate(data,strict=True)
        assert Body.model_validate(draft.model_dump()).model_dump()==data
    else:
        with pytest.raises(ValidationError):DraftDocument.model_validate(data,strict=True)
        with pytest.raises(ValidationError):Body.model_validate(data,strict=True)


def test_live_failure_shape_rejected_before_selection_schema_generation():
    # Synthetic reduction of the held response; no human data or provider IDs.
    value={'goal':'Prepare the opening checklist','success_criteria':[],
           'decision':{'kind':'publish_artifact','target':None,'body':{
               'title':'Opening checklist','blocks':[{'block_id':'scope','kind':'paragraph',
               'text':'Eight volunteers; no external contact.','checked':False}]}}}
    schema=json.loads(CONTINUITY_DECISION_SCHEMA.material)
    doc={**schema['$defs']['DraftDocument'],'$defs':schema['$defs']}
    assert exported_checkbox_types(doc,'paragraph')=={'null'}
    with pytest.raises(Exception):CONTINUITY_DECISION_SCHEMA.validate(json.dumps(value))
    value['decision']['body']['blocks'][0]['checked']=None
    assert CONTINUITY_DECISION_SCHEMA.validate(json.dumps(value)).decision.body.blocks[0].checked is None
