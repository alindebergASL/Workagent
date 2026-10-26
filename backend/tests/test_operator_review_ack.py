"""Synthetic HTTP/journal proof for explicit review and versioned replay."""
import copy
import io
import json
import urllib.error

import pytest

from workagent.operator_client import OperatorClient, OperatorError
from workagent.operator_journal import digest
from workagent import operator_tui


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv('LOCAL_BEARER_TOKEN', 'synthetic-token-' + 'x' * 32)
    monkeypatch.setenv('WORKAGENT_OPERATOR_URL', 'http://127.0.0.1:8765')
    monkeypatch.setenv('WORKAGENT_OPERATOR_JOURNAL', str(tmp_path / 'commands'))
    return OperatorClient()


class ReviewHTTP:
    """No network: exercise urllib Request serialization and real journal I/O."""
    def __init__(self):
        self.calls = []
        self.unknown = False
        self.reject = None
        self.proposal = {
            'id': 'p', 'artifact_id': 'a', 'base_revision_id': 'rev',
            'status': 'pending', 'body': {'kind': 'document', 'blocks': []},
            'review': {'is_latest': False, 'latest_pending_proposal_id': 'newer',
                       'removed_content_count': 1,
                       'removed_content': [{'path': '/notes/0', 'before': 'Human note'}]},
        }
        self.artifact = {'id': 'a', 'current_revision_id': 'rev',
                         'current_revision': {'id': 'rev', 'body': {'notes': ['Human note']}}}

    def open(self, request, timeout):
        self.calls.append((request.method, request.full_url, request.data))
        if request.method == 'POST':
            if self.reject:
                raise urllib.error.HTTPError(request.full_url, 409, 'Conflict', {},
                    io.BytesIO(json.dumps({'code': self.reject}).encode()))
            if self.unknown:
                raise OSError('Lost acknowledgement')
            self.proposal['status'] = 'accepted'
            result = {'id': 'a'}
        elif request.full_url.endswith('/proposals'):
            result = {'items': [self.proposal], 'next_cursor': None}
        else:
            result = self.artifact
        return io.BytesIO(json.dumps(result).encode())

    @property
    def posts(self):
        return [c for c in self.calls if c[0] == 'POST']


def test_new_accept_is_versioned_and_never_infers_consent(client):
    http = ReviewHTTP(); client.opener = http
    client.run('w', 'accept', ['p', 'a', 'rev'], command_id='new')
    record = client.run('w', 'command', ['new'])['record']
    assert record['format'] == 2
    assert record['body']['acknowledge_removed_content'] is False
    assert record['body']['acknowledge_older_proposal'] is False
    assert len(http.posts) == 1


@pytest.mark.parametrize('removed,older', [(True, False), (False, True), (True, True)])
def test_explicit_consent_survives_unknown_and_exact_replay(client, removed, older):
    http = ReviewHTTP(); client.opener = http; http.unknown = True
    with pytest.raises(OperatorError, match='No automatic retry'):
        client.run('w', 'accept', ['p', 'a', 'rev'], command_id='new',
                   acknowledge_removed_content=removed, acknowledge_older_proposal=older)
    saved = client.run('w', 'command', ['new'])
    assert saved['outcome']['state'] == 'outcome_unknown'
    assert len(http.posts) == 1
    assert saved['record']['body']['acknowledge_removed_content'] is removed
    assert saved['record']['body']['acknowledge_older_proposal'] is older
    # Restart; no proposal refresh, precondition renewal or inferred consent.
    http.unknown = False
    restarted = OperatorClient(); restarted.opener = http
    start = len(http.calls)
    restarted.run('w', 'replay', ['new'])
    assert http.calls[start][0] == 'POST'
    assert http.posts[0] == http.posts[1]
    final = restarted.run('w', 'command', ['new'])
    assert final['record'] == saved['record'] and final['digest'] == saved['digest']


# Literal historical records, intentionally NOT prepared with the current builder.
LEGACY = [
    ('accept', ['p', 'a', 'rev'], '/proposals/p/accept',
     {'expected_current_revision_id': 'rev'}),
    ('follow', ['c', '  Preserve\n\"café\"\t ', 'a', 'rev', 'a' * 64], '/conversations/c/messages',
     {'expected_work_version': 7, 'text': '  Preserve\n\"café\"\t ',
      'target': {'artifact_id': 'a', 'revision_id': 'rev', 'body_hash': 'a' * 64}, 'attachments': []}),
    ('create', ['Title', 'Goal', 'project'], '/work-areas',
     {'title': 'Title', 'goal': 'Goal', 'kind': 'project', 'selected_source_refs': []}),
    ('chat', ['Title'], '/conversations', {'title': 'Title', 'selected_source_refs': []}),
    ('cancel', ['c'], '/conversations/c/cancel', {'expected_work_version': 7}),
    ('promote', ['c', 'Title', 'Goal', 'project'], '/work-areas/c',
     {'expected_work_version': 7, 'title': 'Title', 'goal': 'Goal', 'kind': 'project'}),
    ('dismiss', ['p', 'a', 'rev'], '/proposals/p/dismiss',
     {'expected_current_revision_id': 'rev', 'resolution': 'dismiss'}),
    ('revise', ['a', 'rev', '7', 'Keep notes'], '/artifacts/a/request-revision',
     {'base_revision_id': 'rev', 'expected_work_version': 7, 'instruction': 'Keep notes'}),
]


def legacy_record(client, case):
    action, args, path, fields = case
    return {'format': 1, 'command_id': 'legacy', 'base': client.base, 'workspace': 'w',
            'action': action, 'args': args, 'path': '/w' + path,
            'body': {'schema_version': 'workagent/v1', 'request_id': 'legacy',
                     'command_id': 'legacy', **fields}}


@pytest.mark.parametrize('case', LEGACY, ids=[c[0] for c in LEGACY])
def test_format1_replay_frozen_bytes_without_new_payload_builder(client, monkeypatch, case):
    record = legacy_record(client, case)
    original = copy.deepcopy(record)
    wire = json.dumps(record['body']).encode()
    client.journal.reserve(record)
    http = ReviewHTTP(); client.opener = http
    # Even future payload defaults must never reinterpret a legacy envelope.
    monkeypatch.setattr(client, 'payload', lambda *a, **k: pytest.fail('Legacy used new payload builder'))
    monkeypatch.setattr(client, 'readback', lambda record, saved: {'synthetic': 'readback'})
    client.run('w', 'replay', ['legacy'])
    assert http.calls[0] == ('POST', client.base + '/v1/workspaces' + record['path'], wire)
    assert len(http.posts) == 1
    saved = client.journal.read('legacy')
    assert saved['record'] == original and saved['digest'] == digest(original)
    assert json.dumps(saved['record']['body']).encode() == wire
    assert 'acknowledge_removed_content' not in saved['record']['body']
    assert 'acknowledge_older_proposal' not in saved['record']['body']
    if record['action'] == 'follow':
        assert json.dumps(saved['record']['body']['attachments']).encode() == b'[]'
        assert saved['record']['body']['target'] == original['body']['target']


@pytest.mark.parametrize('flag', ['acknowledge_removed_content', 'acknowledge_older_proposal'])
def test_legacy_cannot_be_upgraded_in_place_to_manufacture_consent(client, monkeypatch, flag):
    record = legacy_record(client, LEGACY[0]); record['body'][flag] = True
    client.journal.reserve(record)
    monkeypatch.setattr(client, 'request', lambda *a, **k: pytest.fail('No send'))
    with pytest.raises(OperatorError, match='Corrupt'):
        client.run('w', 'replay', ['legacy'])


@pytest.mark.parametrize('action,args', [('replay', ['legacy']), ('command', ['legacy']), ('chat', ['Hi'])])
def test_flags_cannot_change_existing_commands_or_other_actions(client, monkeypatch, action, args):
    monkeypatch.setattr(client, 'request', lambda *a, **k: pytest.fail('No network'))
    with pytest.raises(OperatorError, match='only.*accept'):
        client.run('w', action, args, acknowledge_removed_content=True)


def test_review_returns_exact_candidate_base_and_server_policy(client):
    http = ReviewHTTP(); client.opener = http
    result = client.run('w', 'review', ['p', 'a', 'rev'])
    assert result['proposal'] == http.proposal
    assert result['base'] == http.artifact
    assert result['review'] == http.proposal['review']
    assert any(url.endswith('/artifacts/a?revision_id=rev') for _, url, _ in http.calls)
    assert http.posts == []


@pytest.mark.parametrize('change', ['base', 'status', 'review'])
def test_review_refuses_stale_or_missing_policy(client, change):
    http = ReviewHTTP(); client.opener = http
    if change == 'base': http.proposal['base_revision_id'] = 'other'
    elif change == 'status': http.proposal['status'] = 'dismissed'
    else: http.proposal['review'] = None
    with pytest.raises(OperatorError):
        client.run('w', 'review', ['p', 'a', 'rev'])
    assert http.posts == []


@pytest.mark.parametrize('flags,expected', [([], (False, False)),
    (['--acknowledge-removed-content'], (True, False)),
    (['--acknowledge-older-proposal'], (False, True)),
    (['--acknowledge-removed-content', '--acknowledge-older-proposal'], (True, True))])
def test_cli_flags_are_explicit_and_false_by_default(monkeypatch, capsys, flags, expected):
    calls = []
    class Client:
        def run(self, *args, **kwargs): calls.append((args, kwargs)); return {'synthetic': True}
    monkeypatch.setattr(operator_tui, 'OperatorClient', Client)
    assert operator_tui.main(['--workspace', 'w', 'accept', 'p', 'a', 'rev', *flags]) == 0
    options = calls[0][1]
    assert options['acknowledge_removed_content'] is expected[0]
    assert options['acknowledge_older_proposal'] is expected[1]


@pytest.mark.parametrize('flags,expected', [('', (False, False)),
    (' --acknowledge-removed-content --acknowledge-older-proposal', (True, True))])
def test_tui_consent_is_per_command_not_sticky(client, monkeypatch, flags, expected):
    calls = []
    def run(ws, action, args, **kwargs):
        if action == 'areas': return {'items': []}
        calls.append((action, args, kwargs)); return {'synthetic': True}
    monkeypatch.setattr(client, 'run', run)
    monkeypatch.setattr(operator_tui.curses, 'curs_set', lambda _: None)
    class Screen:
        keys = iter(':accept p a rev' + flags + '\n:accept p a rev\nq')
        def keypad(self, value): pass
        def getmaxyx(self): return (40, 240)
        def erase(self): pass
        def addnstr(self, *args): pass
        def refresh(self): pass
        def get_wch(self): return next(self.keys)
    operator_tui.interactive(Screen(), client, 'w')
    assert len(calls) == 2
    assert calls[0][0:2] == ('accept', ['p', 'a', 'rev'])
    assert tuple(calls[0][2][f] for f in ('acknowledge_removed_content', 'acknowledge_older_proposal')) == expected
    assert calls[1][2]['acknowledge_removed_content'] is False
    assert calls[1][2]['acknowledge_older_proposal'] is False


@pytest.mark.parametrize('code', ['review_required', 'version_conflict', 'decision_stale'])
def test_server_review_denial_never_adds_consent_or_refreshes_and_retries(client, code):
    http = ReviewHTTP(); client.opener = http; http.reject = code
    with pytest.raises(OperatorError, match=code):
        client.run('w', 'accept', ['p', 'a', 'rev'], command_id='denied')
    assert len(http.posts) == 1
    saved = client.run('w', 'command', ['denied'])
    assert saved['record']['body']['acknowledge_removed_content'] is False
    assert saved['record']['body']['acknowledge_older_proposal'] is False
    assert saved['record']['body']['expected_current_revision_id'] == 'rev'
    assert saved['outcome']['state'] == 'outcome_unknown'
    before = len(http.calls)
    with pytest.raises(OperatorError, match='already reserved'):
        client.run('w', 'accept', ['p', 'a', 'other'], command_id='denied',
                   acknowledge_removed_content=True, acknowledge_older_proposal=True)
    assert len(http.calls) == before
    assert client.journal.read('denied') == saved


@pytest.mark.parametrize('damage', ['missing', 'integer', 'string', 'null', 'unknown-version', 'attachments'])
def test_version2_corruption_cannot_default_or_coerce_consent(client, monkeypatch, damage):
    record = legacy_record(client, LEGACY[0]); record['format'] = 2
    record['body'].update(acknowledge_removed_content=False, acknowledge_older_proposal=False)
    if damage == 'missing': del record['body']['acknowledge_removed_content']
    elif damage == 'unknown-version': record['format'] = 3
    elif damage == 'attachments': record['body']['attachments'] = [{'text': 'never silently dropped'}]
    else: record['body']['acknowledge_removed_content'] = {'integer': 1, 'string': 'true', 'null': None}[damage]
    client.journal.reserve(record)
    monkeypatch.setattr(client, 'request', lambda *a, **k: pytest.fail('No network'))
    with pytest.raises(OperatorError): client.run('w', 'replay', ['legacy'])
    assert client.journal.read('legacy')['record'] == record


def test_legacy_nonempty_attachments_still_refused_not_dropped(client, monkeypatch):
    # Format 1 only ever supported []; widening its grammar would reinterpret
    # previously invalid stored commands rather than preserve legacy semantics.
    record = copy.deepcopy(legacy_record(client, LEGACY[1]))
    record['body']['attachments'] = [{'text': '  original\r\n café  '}]
    original = copy.deepcopy(record)
    client.journal.reserve(record)
    monkeypatch.setattr(client, 'request', lambda *a, **k: pytest.fail('No network'))
    with pytest.raises(OperatorError): client.run('w', 'replay', ['legacy'])
    assert client.journal.read('legacy')['record'] == original


def test_review_refuses_changed_artifact_base(client):
    http = ReviewHTTP(); client.opener = http
    http.artifact['current_revision_id'] = 'human-edit'
    with pytest.raises(OperatorError, match='base changed'):
        client.run('w', 'review', ['p', 'a', 'rev'])
    assert http.posts == []


@pytest.mark.parametrize('action', ['replay', 'command'])
def test_cli_replay_cannot_receive_new_consent(action):
    with pytest.raises(SystemExit) as exc:
        operator_tui.parser().parse_args(['--workspace', 'w', action, 'legacy', '--acknowledge-removed-content'])
    assert exc.value.code == 2
