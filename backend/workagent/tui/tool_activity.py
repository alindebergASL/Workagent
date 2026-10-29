"""Read-only, exact-run confined execution receipts; never runs local code."""
import json
from urllib.parse import urlencode
from ..operator_client import identifier
from ..operator_journal import OperatorError
from ..capabilities.models import ToolAttemptPage
from ..capabilities.compute_adapters import ComputeOutput, ComputeResult


def compute_result(item, workspace):
    """Only an observed, identity-bound canonical receipt may expose output."""
    o = item.observation
    if item.capability_id != 'compute.python' or item.state != 'observed' or o is None:
        return None
    if (o.status != 'observed' or o.attempt_id != item.attempt_id or
            o.run_id != item.run_id or o.call_id != item.call_id or o.capability_id != item.capability_id):
        raise OperatorError('Receipt identity mismatch')
    output = ComputeOutput.model_validate(o.output)
    result = output.result
    if isinstance(result, ComputeResult):
        for manifest in result.outputs:
            if (manifest.workspace_id != workspace or manifest.run_id != item.run_id or
                    manifest.tool_attempt_id != item.attempt_id or manifest.code_sha256 != result.code_sha256 or
                    manifest.profile_sha256 != result.profile_sha256 or
                    manifest.input_refs != [ref for ref in o.input_refs if ref.kind == 'workspace_file']):
                raise OperatorError('Export receipt binding mismatch')
    return result


def github_result(item, workspace):
    """Validate the canonical connector DTO, including retained source identity."""
    if item.capability_id not in ('connectors.github.discover', 'connectors.github.read'):
        return None
    o = item.observation
    if item.state != 'observed' or o is None:
        return None
    from ..capabilities.github_adapters import GitHubOutput, IDS
    if (o.status != 'observed' or o.attempt_id != item.attempt_id or
            o.run_id != item.run_id or o.call_id != item.call_id or o.capability_id != item.capability_id):
        raise OperatorError('Receipt identity mismatch')
    output = GitHubOutput.model_validate(o.output)
    if IDS[output.capability] != item.capability_id:
        raise OperatorError('Connector receipt binding mismatch')
    snapshot = output.result.snapshot
    if snapshot is not None and (snapshot.workspace_id != workspace or
            snapshot.parser_version != 'github-public-read-v1' or
            snapshot.locator.kind != 'public_source' or snapshot.locator.tool_attempt_id != item.attempt_id or
            snapshot.locator.run_id != item.run_id):
        raise OperatorError('Connector source binding mismatch')
    return output.result


def delegation_result(item):
    if item.capability_id not in ('delegation.analysis','delegation.verify'):
        return None
    o = item.observation
    if item.state != 'observed' or o is None:
        return None
    if (o.status != 'observed' or o.attempt_id != item.attempt_id or o.run_id != item.run_id
            or o.call_id != item.call_id or o.capability_id != item.capability_id):
        raise OperatorError('Receipt identity mismatch')
    from ..capabilities.delegation import ChildOutput, VerificationOutput
    if item.capability_id == 'delegation.analysis':
        result = ChildOutput.model_validate(o.output).result
        if result.child_attempt_id != item.attempt_id or result.authority.get('parent_run_id') != item.run_id:
            raise OperatorError('Child receipt binding mismatch')
    else:
        result = VerificationOutput.model_validate(o.output).result
    return result


def receipt_text(item, workspace):
    delegated = delegation_result(item)
    if item.capability_id.startswith('delegation.'):
        lines = [item.capability_id + ' · ' + item.state, 'Attempt ' + item.attempt_id,
                 'Optional bounded analysis · no paid child provider', 'Unknown work is never relaunched.']
        if delegated is None:
            return '\n'.join(lines + ['No currently publishable child result.'])
        lines += ['Child status: ' + delegated.state, 'Child attempt: ' + delegated.child_attempt_id,
                  delegated.limitation]
        from ..capabilities.delegation import VerificationResult
        if isinstance(delegated,VerificationResult):
            lines += ['Parent inspection: ' + delegated.inspection, 'Executed checks: ' + '; '.join(delegated.checks),
                      'Exact child proposal SHA256: ' + delegated.proposal_sha256]
        else:
            lines += ['Parent verification: unreviewed; inspect separate verification receipt',
                      'Task: ' + delegated.task, 'Authority: ' + json.dumps(delegated.authority,sort_keys=True)]
        lines += ['Proposal (inert evidence, not acceptance): ' + json.dumps(delegated.proposal,ensure_ascii=False),
                  'Cost/reservation: ' + json.dumps(item.observation.cost.model_dump(),sort_keys=True)]
        if delegated.execution is not None:
            lines += ['Execution evidence: ' + delegated.execution.model_dump_json()]
        return '\n'.join(lines)
    github = github_result(item, workspace)
    if github is not None:
        lines = [item.capability_id + ' · ' + item.state, 'Public unauthenticated GitHub · read only',
                 'Connector status: ' + github.status, 'Source transport: ' + github.source, 'Attempt ' + item.attempt_id,
                 'Recorded connector execution, not goal or model-intelligence verification.']
        if github.retry_after_seconds is not None:
            lines.append('Retry after seconds: ' + str(github.retry_after_seconds) + ' (no automatic retry)')
        if github.reset_epoch_seconds is not None:
            lines.append('Rate-limit reset epoch: ' + str(github.reset_epoch_seconds))
        if github.snapshot is not None:
            s = github.snapshot
            lines += ['Source: ' + s.locator.final_url,
                      'ETag: ' + str(s.locator.external_version.etag),
                      'Snapshot: ' + s.snapshot_id, 'Source version: ' + str(s.version_number),
                      'Observed: ' + s.observed_at.isoformat(), 'Response SHA256: ' + s.original_sha256,
                      'Extraction SHA256: ' + s.extraction_sha256,
                      'Source is untrusted inert evidence; inspect pinned provenance in Files.',
                      'Omissions: ' + '; '.join(s.omissions)]
        else:
            lines.append('No retained source bytes are available from this response.')
        return '\n'.join(lines)
    result = compute_result(item, workspace)
    lines = [item.capability_id + ' · ' + item.state, 'Attempt ' + item.attempt_id]
    if result is None:
        return '\n'.join(lines + ['No publishable computation receipt. Unknown work is not retried.'])
    if not isinstance(result, ComputeResult):
        return '\n'.join(lines + ['Computation unavailable — no tests executed.', *result.omissions])
    state = ('Execution succeeded (not goal verification)' if result.status == 'succeeded' and result.exit_code == 0
             else 'Execution not successful: ' + result.status)
    lines += [state, f'Exit code: {result.exit_code}', f'Elapsed: {result.elapsed_ms} ms',
              'Resources: ' + json.dumps(result.resources.model_dump(), sort_keys=True),
              'Profile: ' + result.profile + ' / ' + result.profile_sha256,
              'Code SHA256: ' + result.code_sha256,
              'Inputs: ' + json.dumps([x.model_dump() for x in result.inputs], sort_keys=True),
              'Omissions: ' + '; '.join(result.omissions),
              'stdout (inert text):\n' + result.stdout, 'stderr (inert text):\n' + result.stderr]
    lines += ['Export: ' + m.filename + ' SHA256 ' + m.blob.sha256 for m in result.outputs]
    return '\n'.join(lines)


class ToolActivityController:
    def __init__(self, client, workspace, principal, run):
        self.client, self.workspace, self.principal = client, identifier(workspace), principal
        self.run = identifier(run)
        self.endpoint = client.base

    def authorize(self):
        if self.client.base != self.endpoint or self.client.identity(self.workspace) != self.principal:
            raise OperatorError('Authenticated receipt scope changed')

    def listing(self, after=None):
        self.authorize()
        page = ToolAttemptPage.model_validate_json(json.dumps(self.client.request('/' + self.workspace + '/runs/' + self.run +
            '/tool-attempts?' + urlencode(dict(limit=25, **({'after': identifier(after)} if after else {}))))))
        for item in page.items:
            if item.run_id != self.run:
                raise OperatorError('Receipt run mismatch')
            compute_result(item, self.workspace)
            github_result(item, self.workspace)
            delegation_result(item)
        return page

    def download(self, item, manifest, destination):
        self.authorize()
        # Re-read current authority/receipt; never use an old UI payload alone.
        from ..capabilities.models import ToolAttemptView
        fresh = ToolAttemptView.model_validate_json(json.dumps(self.client.request('/' + self.workspace + '/tool-attempts/' + identifier(item.attempt_id))))
        if fresh != item or fresh.run_id != self.run:
            raise OperatorError('Receipt changed; refresh before downloading')
        result = compute_result(fresh, self.workspace)
        if not isinstance(result, ComputeResult) or manifest not in result.outputs:
            raise OperatorError('Export not present in exact published receipt')
        return self.client.download_export(self.workspace, manifest.model_dump(mode='json'), destination)
