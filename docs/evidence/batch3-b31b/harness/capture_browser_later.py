import json
from pathlib import Path
from capture_later import capture
root=Path.cwd();proof=root.parent
f=json.loads((proof/'evidence/browser/fixture.json').read_text());result=json.loads((proof/'evidence/browser/result.json').read_text())
record=capture(f['workspace_id'],f['conversations']['desktop'],'web-reviewed-forgotten')
assert result['results'][0]['forget']['revision_id'] not in record['expected_revisions']
assert result['results'][0]['remember']['revision_id'] not in record['expected_revisions']
assert any(i['memory_id']==result['results'][0]['review']['memory_id'] for i in record['memory_manifest'])
print('Browser UI mutation -> later actual request manifest PASS',record['run_id'])
