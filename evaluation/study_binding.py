"""Immutable reviewed study anchors and pre-effect context isolation checks."""
import hashlib
import json
from pathlib import Path
import subprocess

from network_harness import REPO, inventory

BASELINE_COMMIT = '26e599b3db8a61b73eeeaea4f87a1d3de0b296d9'
SOURCE_HASHES = {'B0': '2a1746aaec0dbd533cbaa49e343e7105d1336c1fdac26f5a5e61679de4687ee9',
                 'B1': '752decb5453298f98269e528f39bc57b2670a307d4abe45da8e48df1dfd03de0',
                 'M1': '752decb5453298f98269e528f39bc57b2670a307d4abe45da8e48df1dfd03de0'}
ENVIRONMENT_SHA256 = '60251f7601a115661c2df4a4da776ec9b1eace7b39f410ab3617ad3aae560fe5'


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def require(condition, reason):
    if not condition:
        from study_controller import Hold
        raise Hold(reason)


def validate_sources(sources):
    from study_source_amendment import sources as amended_sources
    expected=amended_sources(SOURCE_HASHES)
    require(set(sources) == set(expected), 'reviewed_source_set_drift')
    for arm, files in sources.items():
        require(digest(canonical(files)) == expected[arm], 'accepted_source_drift:' + arm)


def environment():
    raw = (REPO/'.local/batch3/b35c/preparation/network-13/execution-environment.json').read_bytes()
    require(digest(raw) == ENVIRONMENT_SHA256, 'retained_environment_anchor_drift')
    original = json.loads(raw)
    files = dict(original['files'])
    # Only the explicit new entrypoints differ from the retained network-13 jail.
    for mounted, name in (('/worker.py','study_worker.py'),('/network_worker.py','network_worker.py'),('/study_transport.py','study_transport.py')):
        files[mounted] = digest((REPO/'evaluation'/name).read_bytes())
    from study_source_amendment import environment as amended_environment
    return amended_environment(dict(original, files=files))


def host_path(mounted):
    if mounted.startswith('/runtime/'):
        return REPO/mounted.removeprefix('/')
    if mounted.startswith('/product/'):
        return REPO/'backend'/mounted.removeprefix('/product/')
    if mounted == '/home/worker/.cache/workagent/o200k_base.tiktoken':
        return Path.home()/'.cache/workagent/o200k_base.tiktoken'
    names = {'/worker.py':'study_worker.py','/network_worker.py':'network_worker.py','/study_transport.py':'study_transport.py'}
    return REPO/'evaluation'/names[mounted] if mounted in names else Path(mounted)


def validate_environment(binding):
    dependencies = REPO/'backend/.venv/lib/python3.12/site-packages'
    require(not any('__pycache__' not in p.parts for p in dependencies.rglob('*.pyc')), 'sourceless_dependency_bytecode')
    require(digest((REPO/'backend/.venv/bin/python').read_bytes()) == binding['files']['/usr/bin/python3'], 'application_interpreter_drift')
    for mounted, expected in binding['files'].items():
        path = host_path(mounted)
        require(path.is_file() and digest(path.read_bytes()) == expected, 'execution_environment_drift:' + mounted)
    require(inventory(REPO/'backend/.venv/lib/python3.12/site-packages') == binding['dependencies'], 'dependency_drift')
    require(digest(Path('/usr/bin/bwrap').read_bytes()) == binding['bwrap_sha256'], 'bwrap_drift')
    require(subprocess.check_output(['uname','-srvm'], text=True).strip() == binding['kernel'], 'kernel_drift')
    require(digest((REPO/'evaluation/network_harness.py').read_bytes()) == binding['launcher_sha256'], 'jail_drift')
    for prefix, directory in (('/product/migrations/', REPO/'backend/migrations'),('/usr/lib/python3.12/',Path('/usr/lib/python3.12'))):
        expected = {p: h for p,h in binding['files'].items() if p.startswith(prefix)}
        actual = {prefix+str(p.relative_to(directory)):digest(p.read_bytes()) for p in directory.rglob('*')
                  if p.is_file() and not p.is_symlink() and '__pycache__' not in str(p) and p.suffix != '.pyc'}
        require(actual == expected, 'execution_file_set_drift:' + prefix)


def validate_context(binding):
    ws, conversations, other = binding['workspaces'], binding['conversations'], binding['other']
    require(len(ws) == 2 and len(set(ws)) == 2, 'aliased_workspaces')
    require(len(conversations) >= 2 and len(set(conversations + [other])) == len(conversations) + 1, 'aliased_conversations')
    require(all(isinstance(x,str) and x for x in [*ws,*conversations,other,binding['principal']]), 'invalid_context_identity')
    grant, other_grant = binding['grant'], binding['other_grant']
    require(grant['id'] != other_grant['id'], 'aliased_grants')
    for g, workspace, ids in ((grant,ws[0],conversations),(other_grant,ws[1],[other])):
        require(g['workspace_id'] == workspace and g['principal_id'] == binding['principal'], 'grant_context_mismatch')
        require(set(g['responses']['conversation_ids']) == set(ids), 'grant_conversation_mismatch')


def validate_contexts(bindings, schedule):
    require(set(bindings) == {t['blind_id'] for t in schedule}, 'exact_trajectory_mapping_required')
    workspaces, conversations = set(), set()
    for trial in schedule:
        b = bindings[trial['blind_id']]
        require(b['blind_id'] == trial['blind_id'], 'mapping_identity_mismatch')
        validate_context(b)
        require(not workspaces.intersection(b['workspaces']), 'cross_trajectory_workspace_alias')
        require(not conversations.intersection(b['conversations']+[b['other']]), 'cross_trajectory_conversation_alias')
        workspaces.update(b['workspaces']); conversations.update(b['conversations']+[b['other']])
    return digest(canonical(bindings))
