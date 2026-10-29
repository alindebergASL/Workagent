"""Durable B3.5c schedule controller. No provider credentials or oracle text in ingress.

The application adapter owns product transactions/worker execution. This controller
owns exact scheduled inputs, ordering, idempotency and evaluator-only receipts.
Unknown operations are reconciled by identity, NEVER retried as fresh work.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sqlite3
from urllib.parse import urlsplit
import urllib.request

from network_harness import inventory
from public_ab_inputs import PREP, ROOT


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


class Hold(RuntimeError):
    pass


# These are protocol events, not a sequence of model choices or a success rubric.
EVENTS = ('initial', 'correction-review', 'worker-recreation-resume',
          'changed-evidence', 'analogous-in-scope-transfer', 'forget-other-project')


def load_schedule():
    freeze = json.loads((PREP/'evaluator/FREEZE.json').read_bytes())
    for item in freeze['files']:
        path = (ROOT/item['path']).resolve()
        if not path.is_relative_to(ROOT) or digest(path.read_bytes()) != item['sha256']:
            raise Hold('frozen_preparation_drift')
    raw = (PREP / 'evaluator/schedule.json').read_bytes()
    schedule = json.loads(raw)['trajectories']
    if len(schedule) != 12 or sum(len(t['episodes']) for t in schedule) != 72:
        raise Hold('original_12_72_schedule_required')
    if len({t['blind_id'] for t in schedule}) != 12:
        raise Hold('duplicate_trajectory')
    for trial in schedule:
        if [e['episode'] for e in trial['episodes']] != list(range(1, 7)):
            raise Hold('episode_order_drift')
        for ep in trial['episodes']:
            directory = ROOT / ep['input_directory']
            meta = json.loads((directory / 'episode.json').read_text())
            if digest((directory / 'prompt.md').read_bytes()) != ep['prompt_sha256']:
                raise Hold('prompt_drift')
            if digest((ROOT / ep['oracle_path']).read_bytes()) != ep['oracle_sha256']:
                raise Hold('oracle_drift')
            if meta['episode'] != ep['episode'] or meta['event'] != EVENTS[ep['episode'] - 1]:
                raise Hold('event_drift')
    return digest(raw), schedule


def ingress(ep):
    directory = ROOT / ep['input_directory']
    meta = json.loads((directory / 'episode.json').read_text())
    names = ['episode.json', 'prompt.md', *meta['source_files']]
    if set(names) != set(inventory(directory)):
        raise Hold('unexpected_input_files')
    if any(Path(n).name != n or (directory / n).is_symlink() for n in names):
        raise Hold('unsafe_input')
    # Exact same encoding for all arms. Only current frozen prompt/source records.
    message = canonical({'prompt': (directory / 'prompt.md').read_text(),
                         'public_sources': [json.loads((directory / n).read_text()) for n in meta['source_files']]})
    return {'message': message, 'message_sha256': digest(message),
            'input_files': inventory(directory), 'event': meta['event'], 'project': meta['project']}


class ApplicationHTTP:
    """Explicit local bridge, no redirect/proxy/ambient credentials or retries.

    POST /operations and GET /operations/<key> are the application bridge API.
    Production provider traffic is NOT sent through this channel.
    """
    def __init__(self, origin):
        u = urlsplit(origin)
        if u.scheme != 'http' or u.hostname != '127.0.0.1' or not u.port or u.path or u.query or u.fragment or u.username:
            raise Hold('loopback_bridge_required')
        self.origin = origin
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                raise Hold('bridge_redirect_denied')
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def call(self, key, operation, payload):
        request = urllib.request.Request(self.origin + '/operations', data=canonical({
            'key': key, 'operation': operation, 'payload': payload}).encode(),
            headers={'Content-Type': 'application/json'}, method='POST')
        with self.opener.open(request, timeout=240) as response:
            return json.load(response)

    def observe(self, key):
        with self.opener.open(self.origin + '/operations/' + key, timeout=30) as response:
            return json.load(response)


class Controller:
    def __init__(self, database: Path, adapter, *, mode='controlled_http'):
        if mode not in ('controlled_http', 'official_api'):
            raise Hold('unknown_transport_mode')
        if mode == 'official_api':
            from study_transport import require_live_release
            require_live_release()  # before opening a store or admitting any operation
        self.mode, self.adapter = mode, adapter
        self.db = sqlite3.connect(database, timeout=30)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS binding(name TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS operations(
              key TEXT PRIMARY KEY, trial TEXT NOT NULL, episode INTEGER NOT NULL,
              operation TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL,
              result TEXT, UNIQUE(trial,episode,operation));
            CREATE TABLE IF NOT EXISTS history(
              seq INTEGER PRIMARY KEY, key TEXT NOT NULL, state TEXT NOT NULL, detail TEXT NOT NULL);
        ''')
        schedule_hash, self.schedule = load_schedule()
        # Freeze all input bytes AND both actual product trees across controller restart.
        self.sources = {v: inventory(ROOT / ('.local/batch3/b35b/baseline/workagent' if v == 'B0' else 'backend/workagent')) for v in ('B0', 'B1', 'M1')}
        from study_binding import validate_sources, environment, validate_environment, BASELINE_COMMIT
        validate_sources(self.sources)
        self.environment = environment()
        validate_environment(self.environment)
        binding = canonical({'schedule_sha256': schedule_hash, 'mode': mode,
                             'baseline_commit': BASELINE_COMMIT, 'environment': self.environment,
                             'live_mapping_sha256': getattr(adapter, 'live_mapping_sha256', None),
                             'execution': {name:digest((ROOT/'evaluation'/name).read_bytes()) for name in
                                           ('study_controller.py','study_application.py','study_worker.py','study_transport.py','study_diagnostic.py','study_binding.py','network_harness.py','network_worker.py')},
                             'sources': self.sources,
                             'inputs': {e['input_directory']: ingress(e)['input_files'] for t in self.schedule for e in t['episodes']}})
        self.execution = json.loads(binding)['execution']
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO binding VALUES ('study',?)", (binding,))
            if self.db.execute("SELECT value FROM binding WHERE name='study'").fetchone()[0] != binding:
                raise Hold('study_binding_drift')

    def close(self):
        self.db.close()

    def _event(self, key, state, detail):
        self.db.execute('INSERT INTO history(key,state,detail) VALUES (?,?,?)', (key, state, canonical(detail)))

    def operation(self, trial, episode, operation, payload):
        if any(digest((ROOT/'evaluation'/name).read_bytes()) != expected for name,expected in self.execution.items()):
            raise Hold('controller_execution_drift')
        body = canonical(payload)
        key = digest(canonical([trial, episode, operation, digest(body)]))
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO operations VALUES (?,?,?,?,?,?,NULL)',
                            (key, trial, episode, operation, body, 'prepared'))
            row = self.db.execute('SELECT * FROM operations WHERE trial=? AND episode=? AND operation=?',
                                  (trial, episode, operation)).fetchone()
            if row['key'] != key:
                raise Hold('operation_payload_drift')
        if row['state'] == 'complete':
            return json.loads(row['result'])
        if row['state'] in ('sending', 'unknown'):
            # Even absence at the remote bridge is NOT proof the effect did not happen.
            result = self.adapter.observe(key)
            if result.get('state') != 'complete' or result.get('key') != key:
                raise Hold('unknown_outcome_no_resend:' + key)
        else:
            with self.db:
                won = self.db.execute("UPDATE operations SET state='sending' WHERE key=? AND state='prepared'", (key,)).rowcount
                if won != 1:
                    raise Hold('concurrent_controller_no_send')
                self._event(key, 'sending', {'payload_sha256': digest(body)})
            try:
                result = self.adapter.call(key, operation, payload)
            except BaseException:
                with self.db:
                    self.db.execute("UPDATE operations SET state='unknown' WHERE key=?", (key,))
                    self._event(key, 'unknown', {'action': 'observe_only'})
                raise
        if result.get('key') != key or result.get('state') != 'complete':
            raise Hold('operation_not_complete:' + key)
        if result.get('payload_sha256') != digest(body):
            raise Hold('operation_receipt_binding_drift')
        with self.db:
            self.db.execute("UPDATE operations SET state='complete',result=? WHERE key=?", (canonical(result), key))
            self._event(key, 'complete', result)
        return result

    def run(self, *, stop_after=None):
        done = 0
        for trial in self.schedule:
            identity = trial['blind_id']
            source_hash = digest(canonical(self.sources[trial['variant']]))
            setup = self.operation(identity, 0, 'open_trajectory', {
                'blind_id': identity, 'variant': trial['variant'], 'source_manifest_sha256': source_hash,
                'memory_recall': trial['memory_recall'], 'mode': self.mode})['value']
            for ep in trial['episodes']:
                number = ep['episode']
                incoming = ingress(ep)
                # State changes complete before exact input admission; the application
                # checks predecessor run settlement, not a fixed model-choice count.
                transition = self.operation(identity, number, 'transition', {
                    'trajectory': setup, 'episode': number, 'event': incoming['event'],
                    'input_directory': ep['input_directory'], 'input_files': incoming['input_files']})['value']
                admitted = self.operation(identity, number, 'ingress', {
                    'trajectory': setup, 'transition': transition, 'episode': number, **incoming})['value']
                outcome = self.operation(identity, number, 'execute', {
                    'trajectory': setup, 'episode': number, 'admitted': admitted})['value']
                if outcome['status'] not in ('ready', 'partial'):
                    raise Hold('worker_not_settled')
                # Partial is a retained outcome, never proof of task usefulness.
                self.operation(identity, number, 'collect', {
                    'trajectory': setup, 'episode': number, 'admitted': admitted,
                    'outcome': outcome, 'oracle_sha256': ep['oracle_sha256']})
                done += 1
                if stop_after is not None and done >= stop_after:
                    return self.summary()
        return self.summary()

    def summary(self):
        rows = self.db.execute("SELECT trial,episode,result FROM operations WHERE operation='collect' AND state='complete' ORDER BY trial,episode").fetchall()
        return {'kind': 'scripted_controller_mechanisms_not_usefulness' if self.mode == 'controlled_http' else 'unscored_live_execution',
                'scheduled_trajectories': 12, 'scheduled_episodes': 72,
                'collected_episodes': len(rows), 'live_episodes': 0 if self.mode == 'controlled_http' else len(rows),
                'paid_calls': 0 if self.mode == 'controlled_http' else None,
                'quality': 'unscored', 'client_usefulness': 'unmeasured',
                'episodes': [json.loads(r['result'])['value'] for r in rows]}

    def export_evaluation(self, output: Path):
        """Independent evaluator interface; arm key and trace stay in this DB.

        No judge calls, scores or oracle feedback. Preserve opaque identities and
        exact output bytes/hashes for a later independent blinded review.
        """
        output.mkdir(exist_ok=False)
        for row in self.db.execute("SELECT trial,episode,result FROM operations WHERE operation='collect' AND state='complete'"):
            value = json.loads(row['result'])['value']
            packet = {k: value[k] for k in ('blind_id', 'episode', 'artifacts', 'messages', 'oracle_sha256', 'evidence_level')}
            packet.update(quality=None, effort=None, judgment='pending_independent_review')
            (output / f"{row['trial']}-{row['episode']}.json").write_text(canonical(packet) + '\n')
