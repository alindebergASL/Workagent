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


def receipt_text(item, workspace):
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
