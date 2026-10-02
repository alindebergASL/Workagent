"""Trusted local deployment and context assembly, never an HTTP/model tool."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

# Repository-local runtime package; deployment runs from either root or backend/.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from runtime.bundles import BundleDenied, BundleLoader, Scope, MAX_CONTEXT_BYTES, require_fixture_mode
from .db import Database
from .models import new_id
from .service import canonical, digest, encoded
from .tool_registry import registry, registry_for_hash, TOOLS

APPROVALS_SHA256 = '2b3c3f79e87c9a28ca127062d6c9deba299bf6f3febc140daee4468f21d721ff'
LEGACY_APPROVALS_SHA256 = 'b531fd4981d5f00922dc1fb53488fcfec98a6d669c4919c9b40736f69a64006f'
# Archived reviewed registries are immutable inputs, not automatic trust in new files.
APPROVAL_SNAPSHOTS = {APPROVALS_SHA256: 'approvals.json', LEGACY_APPROVALS_SHA256: 'approvals-v0.1.json'}


def loader(registry_hash=APPROVALS_SHA256):
    name = APPROVAL_SNAPSHOTS.get(registry_hash)
    if name is None:
        raise BundleDenied('unknown approval registry')
    raw = (ROOT / 'agent' / name).read_bytes()
    if hashlib.sha256(raw).hexdigest() != registry_hash:
        raise BundleDenied('approval registry drift')
    return BundleLoader(ROOT / 'agent', json.loads(raw))


def adapter_hash():
    return hashlib.sha256(Path(__file__).with_name('fixture.py').read_bytes()).hexdigest()


def validate_activation(data):
    approved = loader(data['registry_hash'])
    approved.load(data['version'])
    if (data['bundle_hash'] != approved.approvals[data['version']]['manifest_sha256'] or
            type(data['skills_enabled']) is not bool):
        raise BundleDenied('activation differs from approved configuration')
    return approved


def active_configuration(c):
    row = c.execute('SELECT activation_id FROM runtime_configuration WHERE id=true FOR SHARE').fetchone()
    activation = c.execute('SELECT data FROM bundle_activations WHERE id=%s', (row['activation_id'],)).fetchone()
    validate_activation(activation['data'])
    return row['activation_id'], activation['data']


def pin_run(c, run, assignment, activation_id, activation, grant=None):
    data = {**activation, 'profile': run.profile, 'adapter_sha256': adapter_hash(),
            'tool_registry_sha256': run.tool_registry_hash,
            'source_dependencies': [x.model_dump(mode='json') for x in assignment.selected_source_refs],
            'budget': {'unit': 'fixture_completion', 'limit': run.budget_units},
            'live_usage': 'not_observed', 'live_cost': 'not_observed',
            'model': None, 'hosted_session': None}
    if grant:
        data.update(grant_id=grant.id, model=grant.model, consumer_sha256=grant.consumer_sha256,
                    max_received_output_tokens=grant.max_received_output_tokens,
                    adapter_sha256=None, budget={'unit':'local_publication','limit':1},
                    provider_hard_budget='not_enforced')
        if grant.responses:
            data.update(responses=grant.responses.model_dump(mode='json'),
                        provider_hard_budget='durable_consumer_reservations_not_provider_billing')
    c.execute('INSERT INTO run_configurations(workspace_id,run_id,activation_id,data) VALUES (%s,%s,%s,%s)',
              (run.workspace_id, run.id, activation_id, encoded(data)))


def check_pins(c, run):
    row = c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',
                    (run.workspace_id, run.id)).fetchone()
    if not row:
        raise BundleDenied('run has no approved configuration; explicit new run required')
    data = row['data']
    validate_activation(data)
    registry_for_hash(run.tool_registry_hash)
    if (run.bundle_hash != data['bundle_hash'] or
            run.tool_registry_hash != data['tool_registry_sha256'] or
            run.profile != data['profile'] or run.budget_units > data['budget']['limit']):
        raise BundleDenied('run configuration drift')
    if run.profile=='fixture-deterministic-v1':
        if adapter_hash()!=data['adapter_sha256']:
            raise BundleDenied('fixture adapter drift')
    else:
        from .provider_attempts import check_grant
        grant=check_grant(c,run,data)
        if run.profile=='openai-responses-v1':
            from .responses_worker import validate_pins
            validate_pins(grant,data)
    return data


def assemble_context(service, c, cap):
    p, run, assignment = service._check_capability(c, cap)
    config = check_pins(c, run)
    if run.profile=='openai-responses-v1':
        from .responses_worker import assemble_metadata_context
        return assemble_metadata_context(service,c,cap,run,assignment,config)
    sources = [service._source(c, p, run.workspace_id, ref, True) for ref in assignment.selected_source_refs]
    scope = Scope(assignment.id, run.access_generation,
                  frozenset(x.source_id for x in assignment.selected_source_refs),
                  frozenset(TOOLS), run.budget_units-run.used_units)
    selected = ('analyze-intake' if run.kind == 'initial' else 'resume-work') if config['skills_enabled'] else None
    resources = ['skills/analyze-intake/references/method.md'] if selected == 'analyze-intake' else []
    tools = {t['name']: t for t in registry_for_hash(run.tool_registry_hash)['tools']}
    def current_generation():
        return service._check_capability(c, cap)[1].access_generation
    context = loader(config['registry_hash']).assemble(config['version'], scope, selected, resources,
        [{'id': s['id'], 'version': s['data']['external_version'], 'content': s['content']} for s in sources],
        tools, current_generation)
    # Include accepted objective/current base in the ephemeral plan, never a broad audit body.
    context['assignment'] = {'id': assignment.id, 'goal': assignment.goal,
                             'completion_criteria': assignment.completion_criteria,
                             'instruction': run.instruction, 'base_revision_id': run.base_revision_id}
    if run.artifact_id:
        artifact, _ = service._artifact(c, p, run.workspace_id, run.artifact_id)
        base = service._revision(c, p, run.workspace_id, artifact, assignment, run.base_revision_id)
        context['base_revision'] = base.model_dump(mode='json')
    if len(canonical(context).encode()) > MAX_CONTEXT_BYTES:
        raise BundleDenied('assembled context exceeds limit')
    observation = {k: context[k] for k in ('mode','bundle_version','bundle_manifest_sha256',
        'assignment_id','access_generation','tool_registry_sha256','offered_tools','selected_skill','source_manifest')}
    observation['files'] = [{k: f[k] for k in ('path','sha256')} for f in context['instructions']]
    observation['context_sha256'] = digest(context)
    observation['live_ablation'] = 'not_observed'
    previous = c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',
                         (run.workspace_id, run.id)).fetchone()
    if previous and previous['data'] != observation:
        raise BundleDenied('context changed for pinned run')
    if not previous:
        c.execute('INSERT INTO run_contexts(workspace_id,run_id,data) VALUES (%s,%s,%s)',
                  (run.workspace_id, run.id, encoded(observation)))
    return context


def activate(db, *, version=None, skills_enabled=True, rollback=None):
    """Only a DB table owner can invoke. Rollback writes a new immutable audit row."""
    with db.transaction() as c:
        owner = c.execute("SELECT pg_get_userbyid(relowner)=current_user AS allowed FROM pg_class WHERE oid='bundle_activations'::regclass").fetchone()
        if not owner['allowed']:
            raise BundleDenied('migration identity required')
        current = c.execute('SELECT activation_id FROM runtime_configuration WHERE id=true FOR UPDATE').fetchone()['activation_id']
        if rollback:
            target = c.execute('SELECT data FROM bundle_activations WHERE id=%s', (rollback,)).fetchone()
            if not target:
                raise BundleDenied('unknown rollback target')
            data = target['data']
        else:
            approved = loader()
            approved.load(version)
            data = {'version': version, 'bundle_hash': approved.approvals[version]['manifest_sha256'],
                    'registry_hash': APPROVALS_SHA256, 'skills_enabled': skills_enabled}
        validate_activation(data)
        id = new_id()
        c.execute('INSERT INTO bundle_activations(id,previous_id,rollback_of,data) VALUES (%s,%s,%s,%s)',
                  (id, current, rollback, encoded(data)))
        c.execute('UPDATE runtime_configuration SET activation_id=%s WHERE id=true', (id,))
    # Read back exact target after commit; no credentials or source bodies printed.
    with db.transaction() as c:
        return c.execute('SELECT id,previous_id,rollback_of,data FROM bundle_activations WHERE id=%s', (id,)).fetchone()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--activate', metavar='VERSION')
    group.add_argument('--rollback', metavar='ACTIVATION_ID')
    parser.add_argument('--disable-skills', action='store_true')
    args = parser.parse_args()
    if os.environ.get('LOCAL_TEST_MODE') != 'true':
        parser.error('LOCAL_TEST_MODE=true required')
    print(json.dumps(activate(Database(os.environ['MIGRATION_DATABASE_URL']), version=args.activate,
                              rollback=args.rollback, skills_enabled=not args.disable_skills)))


if __name__ == '__main__':
    main()
