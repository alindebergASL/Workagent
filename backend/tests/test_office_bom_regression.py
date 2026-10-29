"""Keep existing BOM-preserving JSON saves while inspecting office metadata."""
from hashlib import sha256
import json
import pytest
from workagent.workspace_files import text_body

@pytest.mark.parametrize('value',[{'a':1},{'office_version':'office-v1','kind':'document','paragraphs':['Exact human text'],'annotations':['Retained']}])
def test_bom_json_inspection_preserves_original_bytes(value):
    content='\ufeff'+json.dumps(value,ensure_ascii=False)
    digest=sha256(content.encode()).hexdigest()
    body=text_body(content,digest,'application/json')
    assert body.content==content and body.content_sha256==digest
