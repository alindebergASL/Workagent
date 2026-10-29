"""Parent-run real confinement/renderer harness. Missing dependencies FAIL, never skip.

Run with WORKAGENT_OFFICE_PACKAGES pointing to the pinned office site-packages;
run pytest with docs/office packages available for independent file readback.
"""
from hashlib import sha256
import io
import json
import pytest
from workagent import office_sandbox as sandbox
from workagent.office_models import ChartSpec


def test_real_confined_pdf_paginated_quotes_and_annotations():
    from pypdf import PdfReader
    content=dict(office_version='office-v1',kind='document',paragraphs=[
        'Exact attributed quotation: “Keep this exact.”', *['Paragraph '+str(i)+' — readable wrapped text. '*12 for i in range(150)]],
        annotations=['Protected human annotation'])
    raw,omissions,chart=sandbox.convert(json.dumps(content).encode(),'application/json',format='pdf')
    reader=PdfReader(io.BytesIO(raw))
    assert len(reader.pages)>1
    extracted='\n'.join(page.extract_text() for page in reader.pages)
    assert 'Keep this exact.' in extracted and 'Protected human annotation' in extracted
    assert 'No OCR or vision' in extracted and chart is None


def test_real_confined_png_computed_rows_and_image():
    from PIL import Image
    source=b'team,hours\na,0.1\na,0.2\nb,1.5\n'
    spec=ChartSpec(category_column='team',value_column='hours',aggregation='sum',title='Hours by team',x_label='Team',y_label='Hours')
    raw,omitted,chart=sandbox.convert(source,'text/csv',format='png',chart_spec=spec)
    img=Image.open(io.BytesIO(raw));img.verify()
    assert img.size==(1000,600)
    assert chart.input_sha256==sha256(source).hexdigest()
    assert [(r.category,r.value) for r in chart.rows]==[('a','0.3'),('b','1.5')]
    assert chart.spec==spec and any('annotations' in x for x in omitted)


@pytest.mark.parametrize('format',['docx','xlsx'])
def test_real_confined_office_binary_roundtrip(format):
    raw,omissions,_=sandbox.convert('Original quotation “exact”.\nHuman annotation'.encode(),'text/plain',format=format)
    imported,_,_=sandbox.convert(raw,sandbox.FORMATS[format][1],operation='import')
    assert 'Original quotation' in imported.decode() and 'Human annotation' in imported.decode()


def test_real_office_jail_host_environment_network_and_limits(tmp_path,monkeypatch):
    from workagent.document_sandbox import run_confined
    sentinel=tmp_path/'host-secret';sentinel.write_text('synthetic private sentinel')
    monkeypatch.setenv('OFFICE_HOST_SECRET','must not inherit')
    script=tmp_path/'probe.py'
    script.write_text('''
import os,socket,pathlib,resource,json
assert 'OFFICE_HOST_SECRET' not in os.environ
assert not pathlib.Path('/home/ubuntu').exists()
assert resource.getrlimit(resource.RLIMIT_AS)==(1073741824,1073741824)
assert resource.getrlimit(resource.RLIMIT_NPROC)==(16,16)
s=socket.socket();s.settimeout(1)
try:
 s.connect(('1.1.1.1',53))
 raise AssertionError('network allowed')
except OSError: pass
for name in ('/usr/office-write','/packages/office_content.py'):
 try:
  pathlib.Path(name).write_text('bad')
  raise AssertionError('write allowed')
 except OSError: pass
print(json.dumps({'confined':True}))
''')
    code,out,err=run_confined(b'synthetic','probe',module_path=script,packages=sandbox.package_dir(),launcher=sandbox.jail_argv)
    assert code==0 and json.loads(out)=={'confined':True}
    assert sentinel.read_text()=='synthetic private sentinel'
