"""Exact owner-installed implementation transitions, never model authority.

The trusted launcher verifies the mounted inventory (study_binding /
study_source_amendment). Here identity is computed from that loaded tree, never
accepted from a request or environment override. SQL verifies the owner binding;
it does not attest an OS Python image. Runtime DB credentials are trusted-process
credentials, not a public API for executing arbitrary SQL.
"""
from hashlib import sha256
from pathlib import Path

from ..errors import deny
from ..service import digest, encoded
from ..provider_attempts import _owner


TRANSITION_IDS=frozenset(('context.read','files.inspect_json','capabilities.discover_legacy',
    'procedures.load_legacy','files.list','files.read_range','files.create_draft',
    'files.propose_patch','files.compare','artifacts.export','research.capture','research.cite'))


def execution_identity():
    from ..general_responses import consumer_hash
    root=Path(__file__).resolve().parents[1]
    def inventory(directory):
        result={}
        for p in sorted(directory.rglob('*')):
            if '__pycache__' in p.parts or p.suffix=='.pyc':continue
            if p.is_symlink():raise ValueError('symlink in implementation inventory')
            if p.is_file():result[str(p.relative_to(directory))]=sha256(p.read_bytes()).hexdigest()
        return result
    product=inventory(root)
    dependencies={'product':product,'migrations':inventory(root.parent/'migrations')}
    return dict(source_sha256=digest(product),consumer_sha256=consumer_hash(),dependencies=dependencies)


def release_record(descriptor, identity):
    """Immutable, root-normalized record; amendment approval is added later."""
    return dict(descriptor_sha256=digest(descriptor),descriptor=descriptor,
        dependency_inventory=identity['dependencies'],source_sha256=identity['source_sha256'],
        consumer_sha256=identity['consumer_sha256'])


def release_id(descriptor, identity):
    return digest(release_record(descriptor,identity))


def readback(c, run):
    """Host/jail compare durable grant and actual effective loaded release."""
    from .registry import adapters
    g=c.execute('SELECT data,active FROM tool_grants WHERE workspace_id=%s AND run_id=%s',
        (run.workspace_id,run.id)).fetchone()
    if not g or not g['active']:deny()
    current=adapters();descriptors={}
    for pin in g['data']['capabilities']:
        d=current[pin['id']].descriptor
        resolve_for_run(c,run,d)
        descriptors[pin['id']]=d.model_dump(mode='json')
    return dict(tool_grant=g['data'],descriptors=descriptors,execution_identity=execution_identity())


def compatible(old,new):
    return (old.get('id') in TRANSITION_IDS and old.keys()==new.keys()
        and {k:v for k,v in old.items() if k!='implementation_sha256'}==
            {k:v for k,v in new.items() if k!='implementation_sha256'})


def resolve_for_run(c,run,live_descriptor):
    """Current checks remain with the caller; resolve the entire live descriptor."""
    live=live_descriptor.model_dump(mode='json')
    g=c.execute('SELECT id FROM tool_grants WHERE workspace_id=%s AND run_id=%s',
        (run.workspace_id,run.id)).fetchone()
    if not g:deny()
    # Legacy equality needs no source transition, but a partial/disabled mapping
    # never falls back to it. SQL enforces this for every bound pin as well.
    mapped=c.execute('SELECT 1 FROM tool_grant_implementation_bindings WHERE grant_id=%s LIMIT 1',
        (g['id'],)).fetchone()
    identity=execution_identity() if mapped else None
    resolved=c.execute('SELECT tool_implementation_descriptor(%s,%s,%s,%s) d',
        (g['id'],live['id'],identity['source_sha256'] if identity else None,
         identity['consumer_sha256'] if identity else None)).fetchone()['d']
    if resolved!=live:deny()
    return identity


def reserve(c,cap,call,receipt_hash,descriptor):
    from types import SimpleNamespace
    from ..service import digest
    identity=resolve_for_run(c,SimpleNamespace(workspace_id=cap.workspace_id,id=cap.run_id),descriptor)
    if identity:
        return c.execute('SELECT reserve_tool_call_v2(%s,%s,%s,%s,%s,%s,%s,%s) id',
            (cap.workspace_id,cap.run_id,cap.fence,digest(cap.secret),encoded(call),receipt_hash,
             identity['source_sha256'],identity['consumer_sha256'])).fetchone()['id']
    return c.execute('SELECT reserve_tool_call(%s,%s,%s,%s,%s,%s) id',
        (cap.workspace_id,cap.run_id,cap.fence,digest(cap.secret),encoded(call),receipt_hash)).fetchone()['id']


def require_dispatch(c,attempt_id,descriptor):
    # Returning a retained observed result does not execute an adapter. Before a
    # NEW dispatch however the stored descriptor must equal the loaded adapter.
    row=c.execute('SELECT descriptor FROM tool_attempts WHERE id=%s',(attempt_id,)).fetchone()
    if not row or row['descriptor']!=descriptor.model_dump(mode='json'):deny()
    identity=execution_identity()
    ok=c.execute('SELECT tool_attempt_implementation_authorized(%s,%s,%s) ok',
        (attempt_id,identity['source_sha256'],identity['consumer_sha256'])).fetchone()['ok']
    if not ok:deny()


def _binding(c,g,descriptor,identity,amendment,predecessor_source):
    old=c.execute('SELECT descriptor,enabled FROM capability_installations WHERE id=%s AND version=%s',
        (descriptor['id'],descriptor['version'])).fetchone()
    if not old or not old['enabled'] or not compatible(old['descriptor'],descriptor):
        raise ValueError('exact compatible enabled predecessor required')
    pin=next(p for p in g['data']['capabilities'] if p['id']==descriptor['id'])
    release=release_id(descriptor,identity)
    c.execute('INSERT INTO capability_implementation_releases '
        '(release_sha256,descriptor_sha256,descriptor,dependency_inventory,source_sha256,consumer_sha256,capability_id,capability_version,schema_sha256,implementation_sha256) '
        'VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING',
        (release,digest(descriptor),encoded(descriptor),encoded(identity['dependencies']),identity['source_sha256'],identity['consumer_sha256'],
         descriptor['id'],descriptor['version'],descriptor['schema_sha256'],descriptor['implementation_sha256']))
    saved=c.execute('SELECT * FROM capability_implementation_releases WHERE release_sha256=%s',(release,)).fetchone()
    if (not saved['enabled'] or saved['descriptor']!=descriptor or saved['dependency_inventory']!=identity['dependencies']
        or saved['source_sha256']!=identity['source_sha256'] or saved['consumer_sha256']!=identity['consumer_sha256']):
        raise ValueError('immutable release identity conflict')
    body=dict(grant_id=g['id'],capability_id=descriptor['id'],predecessor_pin=pin,
        predecessor_installation_sha256=digest(old['descriptor']),predecessor_source_sha256=predecessor_source,
        release_sha256=release,source_sha256=identity['source_sha256'],consumer_sha256=identity['consumer_sha256'],
        amendment_sha256=amendment)
    binding=digest(body)
    c.execute('INSERT INTO tool_grant_implementation_bindings '
        '(binding_id,grant_id,capability_id,predecessor_pin,predecessor_installation_sha256,predecessor_source_sha256,'
        'release_sha256,source_sha256,consumer_sha256,amendment_sha256) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING',
        (binding,g['id'],descriptor['id'],encoded(pin),body['predecessor_installation_sha256'],predecessor_source,
         release,identity['source_sha256'],identity['consumer_sha256'],amendment))
    actual=c.execute('SELECT binding_id FROM tool_grant_implementation_bindings WHERE grant_id=%s AND capability_id=%s AND source_sha256=%s',
        (g['id'],descriptor['id'],identity['source_sha256'])).fetchone()
    if not actual or actual['binding_id']!=binding:raise ValueError('immutable grant release conflict')


def install_transition(db,grant_ids,*,amendment_sha256,predecessor_source_sha256):
    """Trusted bootstrap only, after approved launch/source-amendment validation.

    Amendment/predecessor inputs are owner evidence, never execution overrides.
    All pins for all supplied grants bind atomically to the computed current tree.
    """
    from .registry import adapters
    if not grant_ids or len(set(grant_ids))!=len(grant_ids):raise ValueError('exact grant set required')
    identity=execution_identity();current=adapters()
    with db.transaction() as c:
        _owner(c)
        for gid in sorted(grant_ids):
            g=c.execute('SELECT * FROM tool_grants WHERE id=%s',(gid,)).fetchone()
            if not g or not g['active']:raise ValueError('active existing grant required')
            c.execute('SELECT id FROM workspaces WHERE id=%s FOR UPDATE',(g['workspace_id'],))
            if not {p['id'] for p in g['data']['capabilities']}<=TRANSITION_IDS:
                raise ValueError('transition outside twelve study capabilities')
            for pin in g['data']['capabilities']:
                _binding(c,g,current[pin['id']].descriptor.model_dump(mode='json'),identity,
                    amendment_sha256,predecessor_source_sha256)
            # Availability is policy-only and may be backed by another retained
            # complete source. Validate THIS computed source before committing.
            for pin in g['data']['capabilities']:
                descriptor=current[pin['id']].descriptor.model_dump(mode='json')
                resolved=c.execute('SELECT tool_implementation_descriptor(%s,%s,%s,%s) d',
                    (g['id'],pin['id'],identity['source_sha256'],identity['consumer_sha256'])).fetchone()['d']
                if resolved!=descriptor:
                    raise ValueError('exact complete installed source transition required')
            if not c.execute('SELECT tool_run_available(%s,%s) ok',(g['workspace_id'],g['run_id'])).fetchone()['ok']:
                raise ValueError('current grant authority or complete transition denied')
    return identity


def bind_new_grant(c,grant_id,*,amendment_sha256=None):
    """Atomic owner bootstrap. A new run has no historical source predecessor.

    Empty-store admission uses the trusted launch amendment, not an invented old
    grant. Existing stores reuse one complete current owner-approved cohort,
    deterministically, without importing that grant's resources or permissions.
    Neither path changes the new grant's current pins, selectors or account.
    """
    from .registry import adapters
    identity=execution_identity();current=adapters()
    g=c.execute('SELECT * FROM tool_grants WHERE id=%s',(grant_id,)).fetchone()
    descriptors=[current[p['id']].descriptor.model_dump(mode='json') for p in g['data']['capabilities']]
    if amendment_sha256 is None:
        candidates=None;seen=False
        for d in descriptors:
            rows=c.execute("""SELECT b.grant_id,b.amendment_sha256,
                (r.enabled AND b.source_sha256=r.source_sha256 AND b.consumer_sha256=r.consumer_sha256) eligible
                FROM tool_grant_implementation_bindings b JOIN capability_implementation_releases r
                  ON r.release_sha256=b.release_sha256 WHERE b.release_sha256=%s""",
                (release_id(d,identity),)).fetchall()
            seen=seen or bool(rows)
            eligible={(r['grant_id'],r['amendment_sha256']) for r in rows if r['eligible'] is True}
            candidates=eligible if candidates is None else candidates & eligible
        if not candidates:
            if seen:raise ValueError('complete current release approval required')
            # Unamended, ordinary installations retain their existing semantics.
            for d in descriptors:
                old=c.execute('SELECT descriptor FROM capability_installations WHERE id=%s AND version=%s',
                    (d['id'],d['version'])).fetchone()
                if not old or old['descriptor']!=d:raise ValueError('approved release required')
            return
        # Keep an already-bound new grant stable on exact retries. Otherwise use
        # one deterministic complete cohort, never a union of partial approvals.
        _,amendment_sha256=min(candidates,key=lambda pair:(pair[0]!=grant_id,pair[1],pair[0]))
    if not {d['id'] for d in descriptors}<=TRANSITION_IDS:
        raise ValueError('initial release outside twelve study capabilities')
    for d in descriptors:
        _binding(c,g,d,identity,amendment_sha256,None)


def installed_for_new_grant(c,descriptor):
    d=descriptor.model_dump(mode='json')
    old=c.execute('SELECT descriptor,enabled FROM capability_installations WHERE id=%s AND version=%s',
        (d['id'],d['version'])).fetchone()
    if not old or not old['enabled']:return False
    if old['descriptor']==d:return True
    identity=execution_identity()
    release=c.execute('SELECT * FROM capability_implementation_releases WHERE release_sha256=%s',
        (release_id(d,identity),)).fetchone()
    return bool(compatible(old['descriptor'],d) and release and release['enabled'] and release['descriptor']==d
        and release['source_sha256']==identity['source_sha256'] and release['consumer_sha256']==identity['consumer_sha256'])
