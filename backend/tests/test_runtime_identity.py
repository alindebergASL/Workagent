from workagent.runtime_identity import manifest,compare


def test_docs_and_presentation_do_not_rebind_runtime(tmp_path):
    backend=tmp_path/'backend/workagent';backend.mkdir(parents=True)
    code=backend/'worker.py';code.write_text('print("synthetic")')
    before=manifest(tmp_path)
    (tmp_path/'STATUS.md').write_text('New checkpoint')
    web=tmp_path/'web';web.mkdir();(web/'page.tsx').write_text('Presentation changes')
    assert compare(before,manifest(tmp_path))['runtime_identical']
    code.write_text('print("different execution")')
    assert compare(before,manifest(tmp_path))['changed_runtime_files']==['backend/workagent/worker.py']


def test_migrations_and_dependencies_are_runtime_relevant(tmp_path):
    root=tmp_path/'backend';(root/'workagent').mkdir(parents=True)
    (root/'workagent/worker.py').write_text('pass')
    before=manifest(tmp_path)
    (root/'migrations').mkdir();(root/'migrations/001.sql').write_text('SELECT 1')
    (root/'requirements-live.txt').write_text('wasmtime==49.0.0')
    assert compare(before,manifest(tmp_path))['changed_runtime_files']==['backend/migrations/001.sql','backend/requirements-live.txt']
