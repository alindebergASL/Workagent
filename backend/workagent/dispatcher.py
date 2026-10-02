"""Durable fixture scheduler. Runs alone own lease/reclaim; outbox only wakes work."""
import argparse
import json
import os
import time

from .db import Database
from .errors import DomainError
from .fixture import run_claimed
from .service import Service, Principal
from .runtime_config import BundleDenied, require_fixture_mode


class Dispatcher:
    def __init__(self, service, *, mode='fixture', workspace=None):
        require_fixture_mode(mode)
        self.service = service
        self.workspace = workspace

    def reconcile(self, workspace, run_id):
        """Post-commit terminal readback + ACK. No new run, turn or side effect."""
        with self.service.db.transaction() as c:
            # Use same workspace -> run ordering as the canonical service.
            c.execute('SELECT id FROM workspaces WHERE id=%s FOR UPDATE', (workspace,))
            row = c.execute('SELECT data FROM runs WHERE workspace_id=%s AND id=%s', (workspace,run_id)).fetchone()
            if not row or row['data']['state'] not in ('ready','partial','cancelled'):
                return False
            dispatch = c.execute('''UPDATE run_dispatches SET acknowledged_at=now()
                WHERE workspace_id=%s AND run_id=%s AND acknowledged_at IS NULL RETURNING outbox_id''',
                (workspace,run_id)).fetchone()
            if dispatch:
                c.execute('''UPDATE outbox SET consumed_at=now() WHERE id=%s AND consumed_at IS NULL
                    AND NOT EXISTS (SELECT 1 FROM run_dispatches WHERE outbox_id=%s AND acknowledged_at IS NULL)''',
                    (dispatch['outbox_id'],dispatch['outbox_id']))
                c.execute("UPDATE outbox SET consumed_at=now() WHERE workspace_id=%s AND object_id=%s AND operation IN ('claim_run','complete_run') AND consumed_at IS NULL", (workspace,run_id))
            return True

    def once(self, *, after_claim=None, after_completion=None):
        """A bounded snapshot sweep. Hooks are local test fault injection, not CLI/API."""
        service = self.service
        result = {'completed': 0, 'reconciled': 0, 'deferred': 0, 'denied': 0}
        with service.db.transaction() as c:
            high = c.execute('SELECT COALESCE(max(cursor),0) AS n FROM run_dispatches').fetchone()['n']
        cursor = 0
        while cursor < high:
            with service.db.transaction() as c:
                rows = c.execute('''SELECT d.cursor,d.workspace_id,d.run_id,r.data FROM run_dispatches d
                    JOIN outbox o ON o.id=d.outbox_id
                    JOIN runs r ON r.workspace_id=d.workspace_id AND r.id=d.run_id
                    WHERE d.acknowledged_at IS NULL AND d.cursor>%s AND d.cursor<=%s
                    AND (%s::text IS NULL OR d.workspace_id=%s)
                    ORDER BY d.cursor LIMIT 100''', (cursor,high,self.workspace,self.workspace)).fetchall()
            if not rows:
                break
            for row in rows:
                cursor = row['cursor']
                ws, rid = row['workspace_id'], row['run_id']
                if self.reconcile(ws,rid):
                    result['reconciled'] += 1
                    continue
                try:
                    # Even concurrent/repeated wakeups use this sole claim authority.
                    cap = service.claim_run(Principal(row['data']['principal_id'],'worker'),ws,rid)
                    if after_claim:
                        after_claim(cap)
                    run_claimed(service,cap)
                    if after_completion:
                        after_completion(cap)
                    if not self.reconcile(ws,rid):
                        raise RuntimeError('completion was not durably terminal')
                    result['completed'] += 1
                except DomainError as exc:
                    result['deferred' if exc.code.value == 'action_unresolved' else 'denied'] += 1
                except BundleDenied:
                    result['denied'] += 1
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once',action='store_true')
    parser.add_argument('--mode',default='fixture')
    parser.add_argument('--workspace')
    parser.add_argument('--interval',type=float,default=1.0)
    args = parser.parse_args()
    # This happens BEFORE reading any DB credentials; no live imports or fallback.
    require_fixture_mode(args.mode)
    if os.environ.get('LOCAL_TEST_MODE') != 'true':
        parser.error('LOCAL_TEST_MODE=true required')
    if args.interval < 0.05:
        parser.error('interval must be at least 0.05 seconds')
    db = Database()
    db.check_runtime_role()
    dispatcher = Dispatcher(Service(db),workspace=args.workspace)
    while True:
        print(json.dumps(dispatcher.once()),flush=True)
        if args.once:
            return
        time.sleep(args.interval)


if __name__ == '__main__':
    main()
