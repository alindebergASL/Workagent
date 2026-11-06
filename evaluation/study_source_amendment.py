"""One explicit post-failure candidate amendment; not an automatic rebaseline.

Approval is a trusted local release artifact. Original funding plans, grants,
certificates, study/controller bindings, inputs and operation keys stay intact.
The manifest binds exact predecessor/successor bytes, never a wildcard epoch.
"""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DIRECTORY=ROOT/'.local/batch3/b35c/gateway-recovery'
MANIFEST=DIRECTORY/'SOURCE_AMENDMENT.json'
APPROVAL=DIRECTORY/'SOURCE_AMENDMENT.approved.sha256'
NAME='gateway-rejection-feedback-v1'

def canonical(value):return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False)
def digest(value):return hashlib.sha256(value if isinstance(value,bytes) else value.encode()).hexdigest()

def require(ok,reason):
    if not ok:
        from study_controller import Hold
        raise Hold('source_amendment:'+reason)

def load():
    if not APPROVAL.exists():return None
    raw=MANIFEST.read_bytes();require(APPROVAL.read_text().strip()==digest(raw),'approval_hash')
    m=json.loads(raw);require(m['name']==NAME and m['scope']=={'trajectories':12,'episodes':72},'scope')
    for name,h in m['files'].items():
        p=(ROOT/name).resolve();require(p.is_relative_to(ROOT) and digest(p.read_bytes())==h,'file:'+name)
    return m

def sources(historical):
    m=load()
    if m is None:return historical
    require(m['historical_sources']==historical,'historical_sources')
    return m['execution_sources']

def environment(original):
    m=load()
    if m is None:return original
    result=dict(original,files=dict(original['files']))
    for mounted,name in m['migration_additions'].items():
        allowed={'/product/migrations/075_gateway_rejection_feedback.sql':'backend/migrations/075_gateway_rejection_feedback.sql',
                 '/product/migrations/076_selection_rejection.sql':'backend/migrations/076_selection_rejection.sql',
                 '/product/migrations/077_gateway_target_rejection.sql':'backend/migrations/077_gateway_target_rejection.sql',
                 '/product/migrations/078_file_input_rejection.sql':'backend/migrations/078_file_input_rejection.sql',
                 '/product/migrations/079_target_create_rejection.sql':'backend/migrations/079_target_create_rejection.sql',
                 '/product/migrations/080_builtin_operation_classification.sql':'backend/migrations/080_builtin_operation_classification.sql',
                 '/product/migrations/081_capability_implementation_releases.sql':'backend/migrations/081_capability_implementation_releases.sql',
                 '/product/migrations/082_native_retained_result_projection.sql':'backend/migrations/082_native_retained_result_projection.sql',
                 '/product/migrations/083_source_cohorts_file_envelope.sql':'backend/migrations/083_source_cohorts_file_envelope.sql',
                 '/product/migrations/084_model_discovery_v2.sql':'backend/migrations/084_model_discovery_v2.sql',
                 '/product/migrations/085_retained_unavailable.sql':'backend/migrations/085_retained_unavailable.sql',
                 '/product/migrations/086_bounded_phase_stop.sql':'backend/migrations/086_bounded_phase_stop.sql'}
        require(mounted not in result['files'] and allowed.get(mounted)==name,'migration_scope')
        result['files'][mounted]=m['files'][name]
    return result

def accept_binding(kind,old,new):
    m=load();require(m is not None,'not_approved')
    assert m is not None
    require(digest(old)==m['bindings'][kind]['before'] and digest(new)==m['bindings'][kind]['after'],'binding:'+kind)
    return m.get('binding_name',NAME)

def opened_payload(old,new):
    """Retain an already issued open operation verbatim, never re-post it."""
    m=load();require(m is not None,'not_approved')
    assert m is not None
    variant=new['variant'];a=dict(old);b=dict(new)
    require(a.pop('source_manifest_sha256')==m['historical_sources'][variant]
        and b.pop('source_manifest_sha256')==m['execution_sources'][variant]
        and a==b,'open_payload')
    return old


def release_lineage(manifest, relative, current):
    """Unwrap exact installed-release transitions to the preserved funding origin.

    Used only by the existing trusted mapping loader. No source argument grants
    permission: actual root files and each complete predecessor inventory bind
    every edge. Historical funding/file-input records remain unchanged.
    """
    from network_harness import inventory
    m=manifest;seen=set()
    require(digest((ROOT/relative).read_bytes())==current,'release_current_file')
    while 'release_transition' in m:
        t=m['release_transition']
        require(t['predecessor_sha256'] not in seen and len(seen)<16,'release_lineage_cycle')
        seen.add(t['predecessor_sha256'])
        def safe(name):
            p=ROOT/name
            require(not Path(name).is_absolute() and '..' not in Path(name).parts,'release_path')
            require(all(not q.is_symlink() for q in (p,*p.parents) if q.is_relative_to(ROOT)),'release_symlink')
            require(p.resolve().is_relative_to(ROOT),'release_path')
            return p
        raw=safe(t['predecessor_manifest']).read_bytes()
        require(digest(raw)==t['predecessor_sha256'],'release_predecessor')
        prior=json.loads(raw);snapshot=safe(t['historical_snapshot'])
        require(not any(p.is_symlink() for p in snapshot.rglob('*')),'release_inventory_symlink')
        old=inventory(snapshot)
        require(digest(canonical(old))==prior['execution_sources']['B1'] and
                prior['execution_sources']==t['predecessor_execution_sources'],'release_inventory')
        require(m['successor']==prior['successor'] and
                m.get('file_input_continuation')==prior.get('file_input_continuation'),'release_funding_history')
        name=relative.removeprefix('backend/workagent/')
        before=old[name]
        require(prior['files'][relative]==before and m['files'][relative]==current,'release_file_binding')
        if before!=current:
            require(t['product_delta'][name]=={'before':before,'after':current},'release_file_delta')
        else:
            require(name not in t['product_delta'],'release_false_delta')
        current=before;m=prior
    return m,current
