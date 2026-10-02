"""Evidence helper: real PostgreSQL records for managed-run states, no provider.

Uses only the backend's trusted seams (handoffs/backend/INTAKE_CONTRACT.md):
an operator grant, a managed assignment, and for `unknown` one explicitly
SYNTHETIC provider attempt that is dispatched and marked unknown. Nothing is
sent anywhere; no model, transport or credential is involved, and the
evidence origin is `synthetic_provider_receipt`, never live.

Run with the backend venv and the disposable env sourced (DATABASE_URL,
MIGRATION_DATABASE_URL), against a workagent_test_* database only:
  python web/scripts/intake_synthetic.py grant
  python web/scripts/intake_synthetic.py managed --goal "..." [--unknown]
  python web/scripts/intake_synthetic.py revoke <grant_id>
"""
import argparse
import json
import os
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from workagent.db import Database  # noqa: E402
from workagent.models import (  # noqa: E402
    CreateAssignment, ProviderGrant, SourceRef, new_id, now)
from workagent.provider_attempts import configure_grant, revoke_grant  # noqa: E402
from workagent.service import Principal, Service, digest  # noqa: E402

WS = 'local-workspace'


def principal():
    return Principal(os.environ.get('LOCAL_PRINCIPAL_ID', 'local-human'))


def main():
    if '/workagent_test_' not in os.environ['DATABASE_URL']:
        raise SystemExit('Refusing: evidence helper runs only on disposable workagent_test_* databases')
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='op', required=True)
    sub.add_parser('grant')
    managed = sub.add_parser('managed')
    managed.add_argument('--goal', required=True)
    managed.add_argument('--unknown', action='store_true')
    revoke = sub.add_parser('revoke')
    revoke.add_argument('grant_id')
    args = parser.parse_args()
    p = principal()
    if args.op == 'grant':
        g = configure_grant(Database(os.environ['MIGRATION_DATABASE_URL']), ProviderGrant(
            id=new_id(), workspace_id=WS, principal_id=p.id, model='synthetic-no-provider',
            consumer_sha256='a' * 64, expires_at=now() + timedelta(minutes=50), max_runs=4))
        print(json.dumps({'grant_id': g.id, 'consumer_sha256': g.consumer_sha256}))
        return
    if args.op == 'revoke':
        revoke_grant(Database(os.environ['MIGRATION_DATABASE_URL']), args.grant_id)
        print(json.dumps({'revoked': args.grant_id}))
        return
    s = Service(Database(os.environ['DATABASE_URL']))
    refs = [SourceRef(source_id=x.id, external_version=x.external_version, observed_at=x.observed_at)
            for x in s.list_sources(p, WS).items][:3]
    created = s.create_assignment(p, WS, CreateAssignment(
        schema_version='workagent/v1', request_id=new_id(), command_id=new_id(), goal=args.goal,
        completion_criteria=['Prepare the next action and name the judgment needed.'],
        selected_source_refs=refs))
    out = {'assignment_id': created.assignment.id, 'run_id': created.run.id,
           'profile': created.run.profile}
    if args.unknown:
        cap = s.claim_run(p, WS, created.run.id)
        attempt = s.prepare_provider_attempt(
            cap, request_hash=digest({'synthetic': 'intake evidence request', 'run': created.run.id}),
            consumer_sha256='a' * 64, evidence_origin='synthetic_provider_receipt')
        receipt = s.bind_provider_receipt(cap, attempt.id)
        s.dispatch_provider_attempt(cap, attempt.id)
        s.mark_provider_unknown(receipt)
        out['attempt_id'] = attempt.id
    print(json.dumps(out))


if __name__ == '__main__':
    main()
