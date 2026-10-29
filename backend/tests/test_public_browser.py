"""Actual offline Chromium + bwrap + cgroup tests (no mocked browser)."""
import http.server
import json
import os
from pathlib import Path
import threading
import subprocess
import time
import pytest
from workagent import public_browser as b


@pytest.fixture
def browser(monkeypatch):
    # Explicit development fixture installation, not an application default.
    root=Path.home()/'.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64'
    assert root.is_dir(), 'Pinned browser fixture must actually be installed'
    monkeypatch.setenv('WORKAGENT_PUBLIC_BROWSER_DIR',str(root))
    b.installed()
    return b.render


def test_real_inline_render_and_ephemeral_profile(browser):
    raw=b'<html><body><script>document.body.innerHTML="Evidence 42";try{localStorage.setItem("secret","x")}catch(e){}</script></body></html>'
    first=browser(raw)
    assert first['status']=='ok' and 'Evidence 42' in first['dom']
    assert first['extractor_version'].startswith(b.PROFILE+':')
    second=browser(b'<script>try{document.write(localStorage.getItem("secret"))}catch(e){document.write("no account state")}</script>')
    assert second['status']=='ok' and 'no account state' in second['dom']


def test_actual_navigation_download_file_and_network_fences(browser,tmp_path):
    calls=[]
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self): calls.append(self.path);self.send_response(200);self.end_headers()
        def do_POST(self): calls.append('POST');self.send_response(200);self.end_headers()
        def log_message(self,*a):pass
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),H)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    secret=tmp_path/'host-private.txt';secret.write_text('HOST_SENTINEL_MUST_NOT_ESCAPE')
    targets=[f'http://127.0.0.1:{server.server_port}/leak','http://169.254.169.254/latest/meta-data/',secret.as_uri()]
    js='''<html><body>Read-only probe<script>
    const targets=TARGETS;
    for (const url of targets) {
      fetch(url,{method:'POST',body:'synthetic-secret'}).then(r=>r.text()).then(t=>document.body.append(t)).catch(()=>{});
      const i=document.createElement('iframe');i.src=url;document.body.append(i);
    }
    const a=document.createElement('a');a.href='data:application/octet-stream;base64,U0VDUkVU';a.download='forbidden.txt';a.click();
    try{window.open(targets[0])}catch(e){}
    </script></body></html>'''.replace('TARGETS',json.dumps(targets))
    try:
        result=browser(js.encode())
        assert result['status']=='ok' and 'HOST_SENTINEL_MUST_NOT_ESCAPE' not in result['dom']
        assert calls==[] and not (tmp_path/'forbidden.txt').exists()
        nav=browser(f'<script>location.href="http://127.0.0.1:{server.server_port}/navigate"</script>'.encode())
        assert nav['status']=='unavailable' and calls==[]
    finally:server.shutdown();server.server_close();thread.join(timeout=3)


def test_actual_resource_timeout_kills_unique_unit(browser):
    before=time.monotonic()
    result=browser(b'<script>while(true){}</script>')
    assert result['status']=='unavailable' and time.monotonic()-before<20
    units=subprocess.check_output(['systemctl','--user','list-units','--no-legend','workagent-public-browser-*'],text=True)
    assert not units.strip()


def test_uninstalled_fails_closed(monkeypatch):
    monkeypatch.delenv('WORKAGENT_PUBLIC_BROWSER_DIR',raising=False)
    assert b.render(b'<script>document.write("x")</script>')['status']=='unavailable'
