"""Offline controller binding of the host helper; no study or PG execution."""
import json
from pathlib import Path
import shutil
from types import SimpleNamespace

import pytest

import study_controller as C
import study_binding as B
import study_source_amendment as A
from amend_retained_read import candidate_context


@pytest.fixture
def controller_image(tmp_path, monkeypatch):
    import socket, psycopg
    def forbidden(*args, **kwargs):
        raise AssertionError('offline binding test forbids external effects')
    monkeypatch.setattr(socket.socket, 'connect', forbidden)
    monkeypatch.setattr(psycopg, 'connect', forbidden)
    image = tmp_path / 'image'
    (image / 'evaluation').mkdir(parents=True)
    for name in ('study_controller.py', 'study_application.py', 'study_worker.py',
                 'study_transport.py', 'study_diagnostic.py', 'study_binding.py',
                 'study_source_amendment.py', 'study_execution.py', 'observe_live_study.py', 'baseline_observation.py',
                 'network_harness.py', 'network_worker.py'):
        shutil.copyfile(C.ROOT / 'evaluation' / name, image / 'evaluation' / name)
    monkeypatch.setattr(C, 'ROOT', image)
    monkeypatch.setattr(C, 'load_schedule', lambda: ('offline-schedule', []))
    monkeypatch.setattr(C, 'inventory', lambda path: {})
    # This test exercises actual Controller/accept_binding and SQLite persistence,
    # not the unrelated frozen72 input/environment validators.
    monkeypatch.setattr(B, 'validate_sources', lambda sources: None)
    monkeypatch.setattr(B, 'environment', lambda: {'offline': True})
    monkeypatch.setattr(B, 'validate_environment', lambda env: None)
    monkeypatch.setattr(A, 'load', lambda: None)
    adapter = SimpleNamespace(call=forbidden, observe=forbidden)
    return image, tmp_path / 'controller.sqlite', adapter


def binding(controller):
    return controller.db.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0]


@pytest.mark.parametrize('name',['study_execution.py','observe_live_study.py','baseline_observation.py'])
def test_helper_drift_denied_before_operation_or_adapter(controller_image,name):
    image, database, adapter = controller_image
    c = C.Controller(database, adapter)
    try:
        helper = image / 'evaluation' / name
        assert c.execution[name] == C.digest(helper.read_bytes())
        helper.write_text(helper.read_text() + '\n# changed helper\n')
        with pytest.raises(C.Hold, match='controller_execution_drift'):
            c.operation('synthetic', 1, 'execute', {})
        assert c.db.execute('SELECT count(*) FROM operations').fetchone()[0] == 0
        assert c.db.execute('SELECT count(*) FROM history').fetchone()[0] == 0
    finally:
        c.close()


def test_helper_is_added_only_through_exact_additive_binding(controller_image):
    image, database, adapter = controller_image
    c = C.Controller(database, adapter)
    new = binding(c)
    old_value = json.loads(new)
    del old_value['execution']['study_execution.py']
    old_value['execution']['study_controller.py'] = 'historical-controller-hash'
    old = C.canonical(old_value)
    with c.db:
        c.db.execute("UPDATE binding SET value=? WHERE name='study'", (old,))
    c.close()
    with pytest.raises(C.Hold, match='not_approved'):
        C.Controller(database, adapter)
    manifest = {'binding_name': 'isolated47-helper', 'bindings': {
        'controller': {'before': A.digest(old), 'after': A.digest(new)}}}
    with candidate_context(manifest):
        c = C.Controller(database, adapter)
        assert binding(c) == old  # historical nine-file binding is untouched
        assert c.db.execute('SELECT value FROM binding WHERE name=?',
                            ('isolated47-helper',)).fetchone()[0] == new
        assert 'study_execution.py' in c.execution
        c.close()
        # An unlisted helper successor cannot reuse this exact amendment.
        helper = image / 'evaluation/study_execution.py'
        helper.write_text(helper.read_text() + '\n# unapproved successor\n')
        with pytest.raises(C.Hold, match='binding:controller'):
            C.Controller(database, adapter)
