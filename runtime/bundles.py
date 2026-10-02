"""Approved product guidance loader. No provider, filesystem tool or permission grant.

The deployment supplies a reviewed approval registry separately from bundle bytes.
Callers must persist manifests/activation in the domain store and recheck live access
at dispatch and result commit; this loader cannot establish those permissions.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path, PurePosixPath
from typing import Any, Callable

MAX_FILE_BYTES = 64_000
MAX_CONTEXT_BYTES = 256_000
ALLOWED_CAPABILITIES = frozenset({
    'inspect-assignment', 'retrieve-permitted-evidence',
    'propose-artifact-revision', 'reconcile-action',
})
MODEL_TOOLS = frozenset({
    'get_assignment', 'get_artifact', 'get_task', 'create_task',
    'propose_artifact_revision', 'get_skill_catalogue', 'get_skill_content',
})


class BundleDenied(ValueError):
    pass


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def read_bounded(root: Path, relative: str) -> bytes:
    """No absolute/traversal/symlink input; root is a product-owned directory."""
    path = PurePosixPath(relative)
    if not relative or path.is_absolute() or '..' in path.parts or '\\' in relative:
        raise BundleDenied('invalid bundle path')
    current = root
    if root.is_symlink():
        raise BundleDenied('symlink bundle root')
    for part in path.parts:
        current = current / part
        if current.is_symlink():
            raise BundleDenied('symlink bundle resource')
    if not current.resolve().is_relative_to(root.resolve()) or not current.is_file():
        raise BundleDenied('missing approved resource')
    with current.open('rb') as stream:
        body = stream.read(MAX_FILE_BYTES + 1)
    if len(body) > MAX_FILE_BYTES:
        raise BundleDenied('oversized bundle resource')
    return body


@dataclass(frozen=True)
class Scope:
    assignment_id: str
    access_generation: int
    allowed_source_ids: frozenset[str]
    allowed_tools: frozenset[str]
    budget_remaining: int


class BundleLoader:
    """Loads only a digest approved by trusted deployment configuration.

    Bundle metadata never grants its own approval. Registry entries include the
    recorded review/test/provenance references. No auto-discovery of customer files.
    """
    def __init__(self, root: Path, approvals: dict[str, dict[str, Any]]):
        self.root = root
        self.approvals = json.loads(json.dumps(approvals))

    def load(self, version: str) -> tuple[dict, dict[str, bytes]]:
        approval = self.approvals.get(version, {})
        if approval.get('approved') is not True or not all(
            approval.get(k) for k in ('review_ref', 'positive_checks_ref', 'negative_checks_ref', 'provenance')
        ):
            raise BundleDenied('bundle not approved')
        # Registry chooses the version directory, never untrusted source content.
        relative = approval.get('manifest', '')
        raw = read_bounded(self.root, relative)
        if digest(raw) != approval.get('manifest_sha256'):
            raise BundleDenied('manifest differs from approved bytes')
        try:
            manifest = json.loads(raw)
        except (ValueError, TypeError) as exc:
            raise BundleDenied('invalid manifest') from exc
        required = {'schema_version', 'version', 'files', 'instructions', 'skills', 'capabilities', 'environment', 'scripts_enabled'}
        if set(manifest) != required or manifest['schema_version'] != 'workagent.bundle/v1' or manifest['version'] != version:
            raise BundleDenied('unsupported bundle schema')
        if manifest['environment'] != 'none' or manifest['scripts_enabled'] is not False:
            raise BundleDenied('execution environment not approved')
        if not isinstance(manifest['capabilities'], list) or not set(manifest['capabilities']) <= ALLOWED_CAPABILITIES:
            raise BundleDenied('unknown capability')
        if not isinstance(manifest['files'], dict) or not 2 <= len(manifest['files']) <= 32:
            raise BundleDenied('invalid resource inventory')
        files = {}
        for path, expected in manifest['files'].items():
            if not isinstance(path, str) or not path.endswith('.md') or path.startswith('scripts/'):
                raise BundleDenied('only approved Markdown guidance supported')
            body = read_bounded(self.root / PurePosixPath(relative).parent, path)
            if digest(body) != expected:
                raise BundleDenied('resource differs from approved bytes')
            try:
                body.decode('utf-8')
            except UnicodeDecodeError as exc:
                raise BundleDenied('resource is not UTF-8') from exc
            files[path] = body
        if not isinstance(manifest['instructions'], list) or len(manifest['instructions']) != 2 or any(p not in files for p in manifest['instructions']):
            raise BundleDenied('operating/persona instructions required')
        seen = set()
        if not isinstance(manifest['skills'], list) or len(manifest['skills']) > 16:
            raise BundleDenied('invalid skill catalogue')
        for skill in manifest['skills']:
            if not isinstance(skill, dict) or set(skill) != {'id', 'version', 'description', 'path', 'resources', 'tools'}:
                raise BundleDenied('invalid skill entry')
            if not isinstance(skill['id'], str) or skill['id'] in seen or not skill['id'] or not isinstance(skill['version'], str):
                raise BundleDenied('invalid skill identity')
            seen.add(skill['id'])
            if not isinstance(skill['description'], str) or not 1 <= len(skill['description']) <= 300:
                raise BundleDenied('invalid skill description')
            if skill['path'] not in files or not isinstance(skill['resources'], list) or any(p not in files for p in skill['resources']):
                raise BundleDenied('unknown skill resource')
            if not isinstance(skill['tools'], list) or not set(skill['tools']) <= MODEL_TOOLS:
                raise BundleDenied('skill cannot expand the model tool registry')
        return manifest, files

    def catalogue(self, version: str, scope: Scope) -> list[dict]:
        manifest, _ = self.load(version)
        if scope.budget_remaining <= 0:
            raise BundleDenied('budget exhausted')
        return [
            {k: s[k] for k in ('id', 'version', 'description')}
            for s in manifest['skills'] if set(s['tools']) <= scope.allowed_tools
        ]

    def assemble(self, version: str, scope: Scope, selected_skill: str | None,
                 resource_paths: list[str], sources: list[dict],
                 tool_registry: dict, current_generation: Callable[[], int]) -> dict:
        """Evidence remains separately tagged data, never privileged instructions.

        A returned object is a context plan, not a live provider observation. The
        domain broker must check the generation again when using this object.
        """
        if current_generation() != scope.access_generation or scope.budget_remaining <= 0:
            raise BundleDenied('scope or budget no longer current')
        manifest, files = self.load(version)
        offered = scope.allowed_tools & MODEL_TOOLS & frozenset(tool_registry)
        selected = None
        if selected_skill is not None:
            selected = next((s for s in manifest['skills'] if s['id'] == selected_skill), None)
            if selected is None or not set(selected['tools']) <= offered:
                raise BundleDenied('skill unavailable in current scope')
        if resource_paths and (selected is None or not set(resource_paths) <= set(selected['resources'])):
            raise BundleDenied('resource not selected by approved skill')
        paths = list(manifest['instructions'])
        if selected:
            paths.append(selected['path'])
        paths.extend(dict.fromkeys(resource_paths))
        permitted = []
        ids = set()
        for source in sources:
            if not isinstance(source, dict) or source.get('id') not in scope.allowed_source_ids or source['id'] in ids:
                raise BundleDenied('source outside current assignment scope')
            if not source.get('version') or 'content' not in source:
                raise BundleDenied('missing source version/content')
            ids.add(source['id'])
            permitted.append({'id': source['id'], 'version': source['version'], 'content': source['content'], 'trust': 'untrusted_evidence'})
        result = {
            'mode': 'application_context_adapter',
            'bundle_version': version,
            'bundle_manifest_sha256': self.approvals[version]['manifest_sha256'],
            'assignment_id': scope.assignment_id,
            'access_generation': scope.access_generation,
            'tool_registry_sha256': digest(canonical(tool_registry)),
            'offered_tools': sorted(offered),
            'catalogue': self.catalogue(version, scope),
            'instructions': [{'path': p, 'body': files[p].decode(), 'sha256': digest(files[p])} for p in paths],
            'selected_skill': None if selected is None else {k: selected[k] for k in ('id', 'version')},
            'sources': permitted,
            'source_manifest': [{'id': s['id'], 'version': s['version'], 'sha256': digest(canonical(s['content']))} for s in permitted],
            'scripts_enabled': False,
        }
        if len(canonical(result)) > MAX_CONTEXT_BYTES:
            raise BundleDenied('assembled context exceeds limit')
        if current_generation() != scope.access_generation:
            raise BundleDenied('scope changed during context assembly')
        return result


def require_fixture_mode(mode: str) -> None:
    """Unavailable live mode fails before credentials, imports or network."""
    if mode != 'fixture':
        raise BundleDenied('live runtime not authorized/configured; not_observed (no fixture fallback)')
