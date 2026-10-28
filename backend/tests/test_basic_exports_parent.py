"""Independent export bytes/annotation checks for the basic-format boundary."""
import csv
import io
import json
from hashlib import sha256
import pytest
from workagent.artifact_exports import render,safe_csv_cell
from workagent.product_models import TableBody
from workagent.flexible_models import Body,Block


@pytest.mark.parametrize('value', ['=1+1','+cmd','-cmd','@SUM(A1:A2)',' =1','\t=1','\r=1','\n=1','\ufeff=1'])
def test_formula_escaping(value):
    assert safe_csv_cell(value)=="'"+value


@pytest.mark.parametrize('value', ['-1','-0','-0.5','-200.50','plain','0','1.5'])
def test_safe_negatives_and_plain_text(value):
    assert safe_csv_cell(value)==value


def test_all_formats_preserve_human_protected_annotation():
    body=Body(title='Synthetic report',blocks=[Block(block_id='human',kind='protected_note',text='Human annotation 雪')])
    for fmt in ('txt','markdown','csv','json'):
        raw,annotations,omissions=render(body,fmt)
        assert 'Human annotation 雪' in raw.decode()
        assert annotations=='included'
        assert not omissions


def test_safe_csv_keeps_exact_bom_crlf_unicode_and_quoting():
    original='\ufeffname,value\r\n"雪",-2.50\r\n'.encode()
    result,_,omissions=render(None,'csv',raw=original,mime_type='text/csv')
    assert result==original and not omissions


def test_unsafe_csv_download_is_real_parseable_and_reports_source_coverage():
    original='\ufeffname,value\r\n雪,-2.50\r\nformula,=1+1\r\n'.encode()
    result,state,omissions=render(None,'csv',raw=original,mime_type='text/csv',source_omissions=['page 2 unavailable'])
    rows=list(csv.reader(io.StringIO(result.decode('utf-8-sig'),newline='')))
    assert rows[1]==['雪','-2.50'] and rows[2]==['formula',"'=1+1"]
    assert 'page 2 unavailable' in result.decode()
    assert state=='explicit_omissions' and omissions==['page 2 unavailable']
