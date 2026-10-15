"""Fresh-fixture real HTTP replay check. No database or provider access.

Invoked by space_fixture launch, whose disposable environment is already loaded.
Two separate CLI processes capture POST *body only*. The first drops the ACK
only after receiving the real committed API response; the next explicitly replays.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any

from workagent.operator_client import OperatorClient


def child(directory, mode, arguments):
    from workagent.operator_tui import main
    original = OperatorClient.__init__

    def init(self):
        client = self
        original(client)
        real = client.opener

        class Capture:
            wrote = False
            def open(self, request, timeout):
                if mode == 'readback-fail' and self.wrote and request.get_method() == 'GET':
                    raise OSError('Controlled readback failure after acknowledgement')
                response = real.open(request, timeout=timeout)
                if request.get_method() == 'POST':
                    self.wrote = True
                    (directory/(mode+'-body.json')).write_bytes(request.data)
                    if mode == 'lost-ack':
                        with response:
                            receipt = json.load(response)
                        (directory/'committed-receipt.json').write_text(json.dumps(receipt, indent=2))
                        raise OSError('Controlled loss AFTER server commit')
                return response
        client.opener = Capture()
    OperatorClient.__init__ = init
    return main(arguments)


def check(directory):
    ws = os.environ['WORKAGENT_WORKSPACE']
    client = OperatorClient()
    conversation = client.run(ws, 'chat', ['Lost acknowledgement fixture'])['receipt']['id']
    cid = 'lost-ack-command'
    def cli(*args, mode=None, env=None, ok=True) -> Any:
        command = [sys.executable, str(Path(__file__).resolve()), str(directory), mode, *args] if mode else [sys.executable, '-m', 'workagent.operator_tui', *args]
        result = subprocess.run(command, env=env, capture_output=True, text=True)
        assert (result.returncode == 0) == ok, result.stderr
        if ok:
            return json.loads(result.stdout)
        return result.stderr
    cli('--command-id', cid, 'follow', conversation, 'Keep this synthetic original prompt', mode='lost-ack', ok=False)
    committed = json.loads((directory/'committed-receipt.json').read_text())
    before = client.run(ws, 'show', [conversation])
    old_version = json.loads((directory/'lost-ack-body.json').read_text())['expected_work_version']
    assert before['conversation']['work_version'] > old_version
    # Advance state again, then restart CLI: replay cannot silently read a new CAS.
    client.run(ws, 'promote', [conversation, 'Replay fixture', 'Synthetic goal', 'project'])
    replay = cli('replay', cid, mode='replayed')
    first_body = (directory/'lost-ack-body.json').read_bytes()
    assert first_body == (directory/'replayed-body.json').read_bytes()
    assert replay['receipt'] == committed
    assert replay['receipt']['run']['id'] == committed['run']['id']
    after = client.run(ws, 'show', [conversation])
    matching = [m for m in after['messages'] if m['text'] == 'Keep this synthetic original prompt']
    assert len(matching) == 1
    assert len([t for t in after['turns'] if t['run_id'] == committed['run']['id']]) == 1
    refusals = []
    for args in [
        ['--command-id',cid,'follow',conversation,'Altered content'],
        ['--command-id',cid,'follow','other-target','Keep this synthetic original prompt'],
        ['--workspace','other-workspace','replay',cid],
        ['--command-id',cid,'cancel',conversation],
    ]:
        refusals.append(cli(*args,ok=False))
    env = os.environ.copy(); env['WORKAGENT_OPERATOR_URL'] = 'http://127.0.0.1:1'
    refusals.append(cli('replay',cid,env=env,ok=False))
    # Replay still goes through current API authorization, not local receipt trust.
    env = os.environ.copy(); env['LOCAL_BEARER_TOKEN'] = 'deliberately-invalid-fixture-token-'+'x'*32
    denied = cli('replay',cid,env=env,ok=False)
    assert 'HTTP 401' in denied
    preserved = cli('command',cid)
    assert preserved['outcome']['receipt'] == committed
    assert preserved['outcome']['state'] == 'outcome_unknown'
    final = cli('replay',cid)
    assert final['receipt']['run']['id'] == committed['run']['id']
    final_state = client.run(ws, 'show', [conversation])
    assert len(final_state['messages']) == len(after['messages'])
    cli('--command-id','readback-command','chat','Readback failure fixture',mode='readback-fail',ok=False)
    unknown = cli('command','readback-command')
    assert unknown['outcome']['state'] == 'readback_unknown'
    assert unknown['outcome']['receipt']['id']
    recovered = cli('replay','readback-command')
    assert recovered['receipt'] == unknown['outcome']['receipt']
    assert len([c for c in client.run(ws,'conversations',[])['items'] if c['title']=='Readback failure fixture']) == 1
    evidence = {'readback_failure_receipt_preserved':True,'passed':True,'fresh_cli_processes':True,'loss_after_commit':True,
        'byte_identical_post_body':True,'body_sha256':hashlib.sha256(first_body).hexdigest(),
        'original_cas':old_version,'version_after_commit':before['conversation']['work_version'],
        'same_canonical_run':committed['run']['id'],'matching_messages':len(matching),
        'scope_content_target_action_refusals':len(refusals),'reauthorization_denied':True,
        'receipt_preserved_after_denied_replay':True,'no_duplicate':True}
    (directory/'real-replay.json').write_text(json.dumps(evidence,indent=2))
    print('Fresh real HTTP command replay passed')


if __name__ == '__main__':
    directory = Path(sys.argv[1])
    if len(sys.argv) > 2:
        raise SystemExit(child(directory, sys.argv[2], sys.argv[3:]))
    check(directory)
