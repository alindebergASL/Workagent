"""Tool names describe the exported entrypoint, not an invoice fixture."""
from types import SimpleNamespace
import pytest
from test_domain import context,cmd
from test_general_products import execute
from workagent.models import HumanSave
from workagent.product_models import RunWasm
from workagent.products import Products


def operation(entrypoint):
    return RunWasm(kind='run_wasm',code=f'(module (func (export "{entrypoint}") (result i64) i64.const 42))',entrypoint=entrypoint,arguments=[],input_form=[])


@pytest.mark.parametrize('entrypoint',['choose','total','_choose','a'*64])
def test_tool_labels_follow_entrypoint(entrypoint):
    body,file,observed=Products()._calculate_product(operation(entrypoint),None)
    assert body.title==f'{entrypoint} tool'
    assert file.filename==f'tool-{entrypoint}.wat'
    assert file.content==body.code and observed.value==42


def test_existing_title_preserved_even_when_entrypoint_changes():
    body,_,_=Products()._calculate_product(operation('choose'),None)
    body.title='My exact combinations calculator'
    updated,_,_=Products()._calculate_product(operation('revised_choose'),SimpleNamespace(body=body))
    assert updated.title==body.title


def test_tool_and_file_download_names_match_and_saved_titles_survive(context):
    s,p,ws,_,_=context
    detail,products=execute(context,operation('choose'))
    tool,file=products
    artifact=s.get_artifact(p,ws,tool.artifact_id)
    assert artifact.current_revision.body.title=='choose tool'
    for aid in (tool.artifact_id,file.artifact_id):
        download=s.download_product(p,ws,aid)
        assert download.filename=='tool-choose.wat'
        assert download.content==artifact.current_revision.body.code
    edited=artifact.current_revision.body.model_copy(update={'title':'My exact combinations calculator'})
    saved=s.human_save(p,ws,tool.artifact_id,cmd(HumanSave,expected_current_revision_id=artifact.current_revision_id,body=edited))
    revised=operation('revised_choose').model_copy(update={'artifact_id':tool.artifact_id,'base_revision_id':saved.current_revision_id})
    execute(context,revised,detail.conversation)
    proposal=s.proposals(p,ws,tool.artifact_id).items[0]
    assert proposal.body.title==edited.title
    assert s.get_artifact(p,ws,tool.artifact_id).current_revision_id==saved.current_revision_id
    assert s.get_artifact(p,ws,tool.artifact_id,tool.revision_id).requested_revision.body.title=='choose tool'
