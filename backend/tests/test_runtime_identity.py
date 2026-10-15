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


def test_contract_tooling_install_is_not_domain_runtime_identity(tmp_path):
    root=tmp_path/'contracts';root.mkdir()
    schema=root/'openapi.json';schema.write_text('{"version":1}')
    before=manifest(tmp_path)
    for name in ('package.json','package-lock.json','tsconfig.json','examples.json'):
        (root/name).write_text('{"fixture":"tooling or illustrative"}')
    dependency=root/'node_modules/schema-tool';dependency.mkdir(parents=True)
    (dependency/'package.json').write_text('{"version":"synthetic"}')
    assert compare(before,manifest(tmp_path))['runtime_identical']
    schema.write_text('{"version":2}')
    assert compare(before,manifest(tmp_path))['changed_runtime_files']==['contracts/openapi.json']
