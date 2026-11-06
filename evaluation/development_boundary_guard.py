"""Read-only development-boundary audit, not an execution/owner-approval gate.

Run with python3 -B evaluation/development_boundary_guard.py. The repo-owned
inventory contains historical observations, not engineering defaults to freeze.
Engineering anchor/hash changes are informational. Safety/evidence/authority-source
anchor changes are TECHNICAL_DRIFT requiring source/evidence review, NOT proof of
lost authorization. Only explicit misclassification/approval claims are AUTHORITY_DRIFT.
--authority-only is the lean CI check: fail on malformed inventory or authority
claims, not stale technical anchors. No product imports, PG, providers or writes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
INVENTORY_PATH = Path('evaluation/development_boundary_inventory.json')
DEFAULT_INVENTORY = ROOT / INVENTORY_PATH
CATEGORIES = {'owner_limit', 'owner_condition', 'engineering_setting', 'safety_invariant',
              'evidence_binding', 'withdrawn_requirement'}
# These classifications implement the controlling docs, not new permissions.
REQUIRED = {
    'cumulative-budget': 'owner_limit',
    'trial-budget': 'engineering_setting',
    'micro-pilot': 'withdrawn_requirement',
    'review-proportionality': 'engineering_setting',
    'installed-accounting-review': 'owner_condition',
    'release-vs-development': 'engineering_setting',
    'new-routes-and-effects': 'owner_limit',
    'maintenance': 'owner_limit',
    'natural-visit-count': 'engineering_setting',
    'per-visit-progress': 'engineering_setting',
    'resume-not-cancellation': 'safety_invariant',
    'helper-no-effect-retry': 'safety_invariant',
    'synthetic-visit-helper': 'engineering_setting',
    'fixture-lifetime': 'engineering_setting',
    'grant-no-renewal': 'safety_invariant',
    'fixture-identity': 'safety_invariant',
    'generic-fixture-prefix': 'safety_invariant',
    'study-invocation-bounds': 'engineering_setting',
    'official-no-lease-surgery': 'safety_invariant',
    'unknown-no-replay': 'safety_invariant',
    'original-study-scope': 'evidence_binding',
    'checkpoint-continuation': 'engineering_setting',
    'source-amendment': 'evidence_binding',
    'live-release': 'evidence_binding',
    'normal-model-capacity': 'engineering_setting',
    'grant-envelopes': 'engineering_setting',
    'tool-capacity': 'engineering_setting',
    'reservation-accounting': 'safety_invariant',
    'phase-allocation': 'engineering_setting',
    'offline-harness-custody': 'safety_invariant',
    'frontend-ci': 'engineering_setting',
    'browser-invocation-bounds': 'engineering_setting',
    'launcher-isolation': 'safety_invariant',
    'launcher-time-bounds': 'engineering_setting',
}


def source(root: Path, name: str) -> Path:
    """Do not turn an inventory typo into a private/out-of-repository read."""
    path = Path(name)
    if path.is_absolute() or '..' in path.parts or not path.parts:
        raise ValueError('unsafe_source_path')
    if path.parts[0] not in {'evaluation', 'backend', 'scripts', 'web', 'docs',
                             '.github', 'AGENTS.md', 'STATUS.md'}:
        raise ValueError('outside_audit_surface')
    if path.suffix not in {'.py', '.md', '.sql', '.json', '.ts', '.mts', '.mjs', '.yml'}:
        raise ValueError('unsupported_source_type')
    if any(part.startswith('.venv') or part in {'node_modules', '.local', '.git'} for part in path.parts):
        raise ValueError('private_or_dependency_source')
    result = (root / path).resolve()
    if not result.is_relative_to(root.resolve()):
        raise ValueError('source_escape')
    # A public-looking symlink must not redirect to private data inside the repo.
    if any(part.startswith('.venv') or part in {'node_modules', '.local', '.git'}
           for part in result.relative_to(root.resolve()).parts):
        raise ValueError('private_or_dependency_source')
    return result


def audit(root: Path, inventory: object, claims: object = None) -> dict:
    """Check recorded anchors/claims only, not semantic/runtime safety in general."""
    malformed, authority, technical, engineering, changed, checked = [], [], [], [], [], {}
    indexed = {}
    entries = inventory.get('boundaries', []) if isinstance(inventory, dict) else None
    if not isinstance(inventory, dict) or inventory.get('schema_version') != 1 or not isinstance(entries, list):
        malformed.append('inventory_schema')
        entries = []
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get('id'), str) or not entry['id']:
            malformed.append('boundary_schema')
            continue
        identity = entry['id']
        if identity in indexed:
            malformed.append('duplicate_boundary:' + identity)
        indexed[identity] = entry
        if not isinstance(entry.get('category'), str) or entry['category'] not in CATEGORIES:
            malformed.append('boundary_category:' + identity)
        for field in ('value', 'reason', 'authority', 'disposition'):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                malformed.append('missing_' + field + ':' + identity)
        refs = entry.get('sources')
        if not isinstance(refs, list) or not refs:
            malformed.append('missing_sources:' + identity)
            continue
        for ref in refs:
            if (not isinstance(ref, dict) or not isinstance(ref.get('path'), str)
                    or not isinstance(ref.get('sha256'), str) or not re.fullmatch('[a-f0-9]{64}', ref['sha256'])
                    or not isinstance(ref.get('anchors'), list) or not ref['anchors']
                    or any(not isinstance(a, str) or not a.strip() for a in ref['anchors'])):
                malformed.append('source_schema:' + identity)
                continue
            name = ref['path']
            try:
                path = source(root, name)
            except (TypeError, ValueError, OSError, RuntimeError):
                malformed.append('unsafe_source:' + identity)
                continue
            try:
                raw = path.read_bytes()
                text = raw.decode('utf-8')
                actual = hashlib.sha256(raw).hexdigest()
                checked[name] = actual
                if actual != ref['sha256']:
                    changed.append(name)
                lines = {line.strip() for line in text.splitlines()}
                if any(a.strip() not in lines for a in ref['anchors']):
                    # Settings are observations, never fixed implementation rules.
                    target = engineering if entry.get('category') == 'engineering_setting' else technical
                    target.append('boundary_anchor_drift:' + identity + ':' + name)
            except (OSError, UnicodeError):
                # Missing source is technical even for settings: disclose coverage.
                technical.append('unreadable_or_invalid_source:' + identity)
    for identity, category in REQUIRED.items():
        if indexed.get(identity, {}).get('category') != category:
            authority.append('authority_classification_drift:' + identity)
    if indexed.get('cumulative-budget', {}).get('value') != '100 USD cumulative; not remaining capacity':
        authority.append('owner_ceiling_drift')
    if claims is not None:
        if not isinstance(claims, list):
            malformed.append('claims_schema')
        else:
            for claim in claims:
                if not isinstance(claim, dict) or set(claim) != {'boundary', 'requires_new_owner_approval'} or type(claim.get('requires_new_owner_approval')) is not bool:
                    malformed.append('claim_schema')
                    continue
                identity = claim['boundary']
                if not isinstance(identity, str) or identity not in indexed:
                    malformed.append('unknown_claim_boundary')
                    continue
                entry = indexed[identity]
                if claim['requires_new_owner_approval'] and entry.get('category') != 'owner_limit':
                    authority.append('setting_promoted_to_owner_gate:' + identity)
                if entry.get('category') == 'withdrawn_requirement':
                    authority.append('withdrawn_requirement_revived:' + identity)
    return {'status': ('AUDIT_DRIFT' if malformed else 'AUTHORITY_DRIFT' if authority
                       else 'TECHNICAL_DRIFT' if technical else 'PASS'),
            'scope': 'static anchors/explicit claims only; technical drift is not an owner-approval requirement',
            'boundaries': len(indexed), 'errors': sorted(set(malformed + authority + technical)),
            'inventory_errors': sorted(set(malformed)), 'authority_errors': sorted(set(authority)),
            'technical_drift': sorted(set(technical)),
            'engineering_changes_informational': sorted(set(engineering)),
            'source_hash_changes_informational': sorted(set(changed)),
            'checked_files': dict(sorted(checked.items()))}


def exit_code(result: dict, authority_only: bool = False) -> int:
    if authority_only:
        return int(bool(result.get('inventory_errors') or result.get('authority_errors')))
    return int(result['status'] != 'PASS')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--inventory', type=Path, help='Default: evaluation/development_boundary_inventory.json under --root')
    parser.add_argument('--claims', type=Path, help='Optional explicit task boundary claims JSON; never executes them')
    parser.add_argument('--authority-only', action='store_true', help='CI: technical anchor drift stays visible but is not an approval/development gate')
    args = parser.parse_args()
    try:
        inventory = json.loads((args.inventory or args.root / INVENTORY_PATH).read_text())
        claims = json.loads(args.claims.read_text()) if args.claims else None
        result = audit(args.root, inventory, claims)
    except (OSError, ValueError):
        result = {'status': 'AUDIT_DRIFT', 'errors': ['invalid_input'], 'inventory_errors': ['invalid_input']}
    print(json.dumps(result, sort_keys=True, indent=2))
    return exit_code(result, args.authority_only)


if __name__ == '__main__':
    raise SystemExit(main())
