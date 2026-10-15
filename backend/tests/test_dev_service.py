"""Live launch selects the real dispatcher, not a controlled-only executor."""
import importlib.util
from pathlib import Path
import json
import pytest

ROOT = Path(__file__).resolve().parents[2]

def module():
    spec = importlib.util.spec_from_file_location('dev_service', ROOT / 'scripts/dev_service.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def config(tmp_path):
    env = tmp_path/'runtime.env'
    env.write_text('DATABASE_URL=postgresql://runtime@127.0.0.1/retained\nLOCAL_BEARER_TOKEN='+ 'x'*40+'\nMIGRATION_DATABASE_URL=secret-admin\nOPENAI_API_KEY=ambient-secret\n')
    env.chmod(0o600)
    authority = tmp_path/'authority.json'
    authority.write_text('{}')
    state = tmp_path/'worker-state'
    state.mkdir(mode=0o700)
    p = tmp_path/'service.json'
    p.write_text(json.dumps(dict(name='workagent-alpha',root=str(ROOT),python='/usr/bin/python3',node='/usr/bin/python3',env_file=str(env),authority_record=str(authority),state_dir=str(state),workspace='workspace',grant_id='grant',api_port=8152,web_port=3152)))
    p.chmod(0o600)
    return p


def test_worker_is_real_shared_dispatcher_and_preserves_state(tmp_path):
    m=module(); c=m.load_config(config(tmp_path))
    argv,cwd,env=m.command(c,'worker')
    assert argv[1:3]==['-m','workagent.responses_dispatcher']
    assert '--general-responses' in argv and '--serve' in argv
    assert '--general-controlled' not in argv
    assert argv[argv.index('--state-dir')+1]==str(tmp_path/'worker-state')
    assert cwd==ROOT/'backend'
    assert not any(k in env for k in ('OPENAI_API_KEY','MIGRATION_DATABASE_URL'))
    assert env['DATABASE_URL'].endswith('/retained')


def test_web_receives_no_database_credentials(tmp_path):
    m=module(); c=m.load_config(config(tmp_path))
    argv,cwd,env=m.command(c,'web')
    assert '--hostname' in argv and '127.0.0.1' in argv
    assert 'DATABASE_URL' not in env
    assert env['WORKAGENT_BACKEND_URL']=='http://127.0.0.1:8152'


def test_supervision_keeps_resources_and_restarts_components(tmp_path):
    m=module(); path=config(tmp_path); c=m.load_config(path)
    units=m.units(c,path)
    assert set(units)=={'workagent-alpha.target','workagent-alpha-api.service','workagent-alpha-web.service','workagent-alpha-worker.service'}
    for name,text in units.items():
        if name.endswith('.service'):
            assert 'Restart=always' in text and 'UMask=0077' in text
            assert 'PartOf=workagent-alpha.target' in text
            assert 'ExecStopPost=' not in text and 'RuntimeDirectory=' not in text
            assert 'secret-admin' not in text and 'xxxxxxxx' not in text


@pytest.mark.parametrize('field,value',[('api_port',3152),('state_dir','relative'),('name','bad\nExecStart=evil'),('workspace','x/y')])
def test_invalid_configuration_fails_closed(tmp_path,field,value):
    m=module(); p=config(tmp_path); d=json.loads(p.read_text());d[field]=value;p.write_text(json.dumps(d))
    with pytest.raises(ValueError):m.load_config(p)


def test_refuses_missing_state_and_world_readable_environment(tmp_path):
    m=module(); p=config(tmp_path)
    (tmp_path/'worker-state').rmdir()
    with pytest.raises(ValueError):m.load_config(p)
    (tmp_path/'worker-state').mkdir(mode=0o700)
    (tmp_path/'runtime.env').chmod(0o644)
    with pytest.raises(ValueError):m.load_config(p)
