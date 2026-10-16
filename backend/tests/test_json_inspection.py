"""Pure structured-text inspection; no network, provider or execution privileges."""
from hashlib import sha256
import json
import pytest
from workagent.json_inspection import inspect_json


def inspect(content,path=None):
    attachment={'ref':'attachment-synthetic','sha256':sha256(content.encode()).hexdigest(),
                'content':content,'mime_type':'text/plain'}
    return inspect_json(attachment,path or [])


def test_nested_config_is_exact_data_not_code():
    result=inspect('{"service":{"port":8152,"enabled":false,"note":"=CMD()"}}',['service'])
    assert result['status']=='complete'
    assert json.loads(result['selected_json'])=={'port':8152,'enabled':False,'note':'=CMD()'}
    assert result['value_bytes']==len(result['selected_json'].encode())
    assert result['reason'] is None


def test_arrays_null_and_literal_keys_preserve_meaning():
    assert inspect('[null,{"a/b":{"~":0.10000000000000001}}]',['0'])['selected_json']=='null'
    value=inspect('[null,{"a/b":{"~":0.10000000000000001}}]',['1','a/b','~'])
    assert value['selected_json']=='0.10000000000000001'
    assert inspect('{"01":"001"}',['01'])['selected_json']=='"001"'
    for path in (['-1'],['01'],['2'],['0','x']):
        assert inspect('[null,{}]',path)['status']=='not_found'


@pytest.mark.parametrize('content,reason',[
    ('{"x":1,"x":2}','invalid_json'), ('{"x":NaN}','invalid_json'),
    ('{"x":Infinity}','invalid_json'), ('{} commentary','invalid_json'),
    ('\ufeff{}','invalid_json'), ('{"x":"\\ud800"}','invalid_json'),
    ('[1e999]','number_limit'), ('['*40+'0'+']'*40,'structure_limit'),
    ('[1e999999999999999999999999999999]','invalid_json'),
    ('["\\u0000"]','invalid_json'),
    ('['+','.join(['0']*10001)+']','structure_limit'),
])
def test_invalid_or_excessive_input_returns_closed_error(content,reason):
    r=inspect(content)
    assert (r['status'],r['reason'],r['selected_json'],r['value_bytes'])==('invalid_input',reason,None,None)
    assert set(r)=={'attachment','path','status','reason','selected_json','value_bytes','limit_bytes'}


def test_whole_selected_value_limits_no_partial_or_invented_data():
    r=inspect(json.dumps({'small':'yes','large':'x'*17000}),['large'])
    assert r['status']=='size_limit' and r['selected_json'] is None and r['value_bytes']==17002
    r=inspect(json.dumps({'small':'yes','large':'x'*17000}),['small'])
    assert r['status']=='complete' and r['selected_json']=='"yes"'
    assert inspect(' '*200001)['reason']=='input_limit'


def test_unicode_and_exponents_preserved_as_valid_json_text():
    r=inspect('{"country":"Norge 🇳🇴","ratio":1.25e-8,"id":12345678901234567890}')
    assert r['status']=='complete'
    assert 'Norge 🇳🇴' in r['selected_json'] and '0.0000000125' in r['selected_json']
    assert '12345678901234567890' in r['selected_json']
