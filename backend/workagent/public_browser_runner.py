"""Fixed CDP program executed INSIDE the networkless public-browser jail only.

No caller-provided commands, expressions, URLs, headers, cookies or profiles.
Input is one already fetched HTML document, not a browser navigation grant.
"""
import base64
import json
import os
from pathlib import Path
import select
import signal
import time

MAX_DOM = 262144


def main():
    raw = Path('/input').read_bytes()
    if len(raw) > 262144:
        raise ValueError('input_limit')
    url = 'data:text/html;base64,' + base64.b64encode(raw).decode('ascii')
    child_read, parent_write = os.pipe()
    parent_read, child_write = os.pipe()
    pid = os.fork()
    if pid == 0:
        # Duplicate away from CDP's reserved 3/4 before arranging inherited fds.
        read_copy, write_copy = os.dup(child_read), os.dup(child_write)
        os.dup2(read_copy, 3, inheritable=True)
        os.dup2(write_copy, 4, inheritable=True)
        for fd in {child_read, parent_write, parent_read, child_write, read_copy, write_copy} - {3, 4}:
            os.close(fd)
        os.execve('/browser/chrome-headless-shell', ['/browser/chrome-headless-shell',
            '--no-sandbox', '--headless', '--disable-gpu', '--disable-dev-shm-usage',
            '--disable-background-networking', '--disable-extensions', '--disable-sync',
            '--no-first-run', '--no-default-browser-check', '--disable-breakpad',
            '--disable-component-update', '--disable-features=Translate,MediaRouter',
            '--js-flags=--max-old-space-size=96', '--user-data-dir=/tmp/profile',
            '--remote-debugging-pipe', 'about:blank'],
            {'HOME':'/tmp', 'TMPDIR':'/tmp', 'LANG':'C.UTF-8'})
    os.close(child_read); os.close(child_write)
    sequence = 0
    buffer = bytearray()
    deadline = time.monotonic() + 8
    blocked = 0
    pending = {}

    def send(method, params=None, session=None):
        nonlocal sequence
        sequence += 1
        item = {'id':sequence, 'method':method, 'params':params or {}}
        if session: item['sessionId'] = session
        payload = json.dumps(item).encode() + b'\0'
        while payload:
            n = os.write(parent_write, payload); payload = payload[n:]
        return sequence

    def receive():
        nonlocal blocked
        while b'\0' not in buffer:
            if time.monotonic() > deadline: raise TimeoutError()
            if select.select([parent_read], [], [], .05)[0]:
                data = os.read(parent_read, 65536)
                if not data: raise ValueError('browser_exit')
                buffer.extend(data)
                if len(buffer) > 1048576: raise ValueError('output_limit')
        packet, _, rest = buffer.partition(b'\0'); buffer[:] = rest
        event = json.loads(packet)
        if event.get('method') == 'Fetch.requestPaused':
            blocked += 1
            send('Fetch.failRequest', {'requestId':event['params']['requestId'], 'errorReason':'BlockedByClient'}, event['sessionId'])
        if event.get('method') == 'Page.javascriptDialogOpening':
            send('Page.handleJavaScriptDialog', {'accept':False}, event['sessionId'])
        if 'id' in event: pending[event['id']] = event
        return event

    def call(method, params=None, session=None):
        identifier = send(method, params, session)
        while identifier not in pending: receive()
        result = pending.pop(identifier)
        if 'error' in result: raise ValueError('cdp_failure')
        return result.get('result', {})

    try:
        call('Browser.setDownloadBehavior', {'behavior':'deny'})
        targets = call('Target.getTargets')['targetInfos']
        target = next(t['targetId'] for t in targets if t['type'] == 'page')
        session = call('Target.attachToTarget', {'targetId':target, 'flatten':True})['sessionId']
        call('Page.enable', session=session)
        # All resource fetches denied, including script-driven file/private HTTP,
        # redirects, popups' network (OS fence), and downloadable resources.
        call('Fetch.enable', {'patterns':[{'urlPattern':'*','requestStage':'Request'}]}, session)
        call('Page.navigate', {'url':url}, session)
        call('Emulation.setVirtualTimePolicy', {'policy':'advance', 'budget':1000}, session)
        while True:
            event = receive()
            if event.get('method') == 'Emulation.virtualTimeBudgetExpired': break
        result = call('Runtime.evaluate', {'expression':
            'JSON.stringify({url:location.href,dom:document.documentElement.outerHTML})',
            'returnByValue':True, 'timeout':1000}, session)
        material = json.loads(result['result']['value'])
        if material['url'] != url: raise ValueError('navigation_denied')
        dom = material['dom']
        if len(dom.encode()) > MAX_DOM: raise ValueError('output_limit')
        print(json.dumps({'dom':dom, 'blocked_requests':blocked}, ensure_ascii=True))
    finally:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)


if __name__ == '__main__':
    main()
