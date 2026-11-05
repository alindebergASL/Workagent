"""Finite evaluation backstops, not product leases, authority or resend policy."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import signal
import subprocess
import threading
import time

WORKER_SECONDS = 1200  # 600 claim + measured170 cold start +430 setup/cleanup margin
CLAIM_SECONDS = 600    # Only used to bound natural waiting; never changes a lease.
NONEXECUTE_SECONDS = 1200  # Preserve the prior adapter backstop for setup/collect.
APPLICATION_MARGIN = 600
CONTROLLED_VISITS = 20
OBSERVER_SECONDS = 4 * 60 * 60
NO_PROGRESS_SECONDS = 60 * 60
TERM_GRACE_SECONDS = 10
REAP_SECONDS = 10


class ExecutionStopped(RuntimeError):
    """The operation may have effects. Keep its durable receipt unknown."""


def application_seconds(mode, operation):
    if mode not in ('official_api', 'controlled_http'):
        raise ValueError('unknown_execution_route')
    if operation != 'execute':
        return NONEXECUTE_SECONDS
    if mode == 'official_api':
        return WORKER_SECONDS + APPLICATION_MARGIN
    return CONTROLLED_VISITS * (WORKER_SECONDS + CLAIM_SECONDS) + APPLICATION_MARGIN


class ProgressWindow:
    def __init__(self, initial, *, overall=OBSERVER_SECONDS, idle=NO_PROGRESS_SECONDS, clock=time.monotonic):
        self.clock = clock
        self.start = self.last_progress = clock()
        self.overall, self.idle = overall, idle
        self.counters = dict(initial)

    def observe(self, counters):
        if any(counters.get(k, 0) < v for k, v in self.counters.items()):
            raise ExecutionStopped('durable_progress_regressed')
        if any(v > self.counters.get(k, 0) for k, v in counters.items()):
            self.last_progress = self.clock()
        self.counters = dict(counters)

    def check(self, required=0):
        current = self.clock()
        if current + required >= self.start + self.overall:
            raise ExecutionStopped('evaluation_overall_bound')
        if current + required >= self.last_progress + self.idle:
            raise ExecutionStopped('evaluation_no_durable_progress')


def durable_progress(service, run_id):
    """Append-only progress, excluding claims/lease refreshes and repeated polls.

    Authority is still checked by the normal worker; these counters grant nothing.
    No request, result, credential or material contents leave this query.
    """
    with service.db.transaction() as c:
        rows = c.execute('''
          SELECT 'prepared' AS kind,count(*) AS n FROM responses_steps s
            JOIN provider_attempts a ON a.id=s.attempt_id WHERE a.run_id=%s
          UNION ALL SELECT 'response:'||e.kind,count(*) FROM responses_events e
            JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.kind NOT IN ('read','cancel') GROUP BY e.kind
          UNION ALL SELECT 'native:reserved',count(*) FROM tool_attempts WHERE run_id=%s
          UNION ALL SELECT 'native:'||e.kind,count(*) FROM tool_attempt_events e
            JOIN tool_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s GROUP BY e.kind
        ''', (run_id, run_id, run_id, run_id)).fetchall()
    return {r['kind']:r['n'] for r in rows}


def _record(path, value):
    temporary = path.with_suffix(path.suffix + '.next')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(value, f, sort_keys=True); f.write('\n'); f.flush(); os.fsync(f.fileno())
    os.replace(temporary, path)


@contextmanager
def application_window(seconds):
    """Bound the observer's in-process application call too, not its lease."""
    if threading.current_thread() is not threading.main_thread():
        raise ExecutionStopped('application_supervisor_requires_main_thread')
    previous_handler = signal.getsignal(signal.SIGALRM)
    previous_timer = signal.getitimer(signal.ITIMER_REAL)
    if previous_timer != (0.0, 0.0):
        raise ExecutionStopped('existing_application_alarm')
    def expired(_signum, _frame):
        raise ExecutionStopped('application_timeout_unknown')
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try: yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)


def run_owned(argv, *, input, cwd, timeout, evidence, env=None):
    """One owned process group, streaming evidence, bounded cleanup, no retry.

    Both callers launch fixed trusted programs. The application launches bwrap
    with --die-with-parent/--unshare-all; its separate sandbox session is killed
    by bwrap's parent-death contract if outer supervision kills the application.
    No credentials/input or exception repr are placed in process metadata.
    """
    evidence = Path(evidence)
    stdout_path, stderr_path = Path(str(evidence)+'.stdout'), Path(str(evidence)+'.stderr')
    meta_path = Path(str(evidence)+'.process.json')
    if meta_path.exists():
        raise ExecutionStopped('existing_process_receipt_no_replay')
    metadata = dict(status='starting', timeout_seconds=timeout, pid=None, returncode=None)
    fd = os.open(meta_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(metadata,f);f.flush();os.fsync(f.fileno())
    process = None
    old_handlers = {}
    interrupted = False
    alarm_expired = False
    def terminate(_signum, _frame):
        nonlocal interrupted, alarm_expired
        alarm_expired = alarm_expired or _signum == signal.SIGALRM
        interrupted = interrupted or _signum != signal.SIGALRM
        if process is not None:
            raise ExecutionStopped('evaluation_interrupted')
    try:
        if threading.current_thread() is threading.main_thread():
            for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGALRM):
                old_handlers[sig] = signal.signal(sig, terminate)
        # Direct files retain partial bytes even if a supervising process dies.
        out_fd = os.open(stdout_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(out_fd, 'wb') as out:
            err_fd = os.open(stderr_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(err_fd, 'wb') as err:
                if interrupted or alarm_expired:raise ExecutionStopped('evaluation_interrupted_before_spawn')
                try:
                    process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=out, stderr=err,
                        cwd=cwd, env=env, start_new_session=True, close_fds=True)
                    metadata.update(status='running', pid=process.pid, process_group=process.pid,
                        start_ticks=Path(f'/proc/{process.pid}/stat').read_text().rsplit(')',1)[1].split()[19])
                    _record(meta_path, metadata)
                    if interrupted or alarm_expired:raise ExecutionStopped('evaluation_interrupted')
                    process.communicate(input.encode('utf-8'), timeout=timeout)
                except BaseException as exc:
                    if process is None:raise
                    metadata.update(pid=process.pid, process_group=process.pid)
                    metadata['status'] = 'timeout' if alarm_expired or isinstance(exc, subprocess.TimeoutExpired) else 'interrupted'
                    try:_record(meta_path, metadata)
                    except OSError:pass # cleanup still owns a child even if disk evidence fails
                    # Signals are deferred during Popen until the owned PID is
                    # assigned. Never signal a group whose leader was already
                    # reaped by communicate; an unreaped PID cannot be reused.
                    if threading.current_thread() is threading.main_thread():
                        for sig in old_handlers:signal.signal(sig, signal.SIG_IGN)
                        signal.setitimer(signal.ITIMER_REAL, 0)
                    if process.returncode is None:
                        for sig in (signal.SIGTERM, signal.SIGKILL):
                            try: os.killpg(process.pid, sig)
                            except ProcessLookupError: pass
                            if sig == signal.SIGTERM: time.sleep(TERM_GRACE_SECONDS)
                    try: process.wait(timeout=REAP_SECONDS)
                    except subprocess.TimeoutExpired:
                        metadata['status']='cleanup_unconfirmed';_record(meta_path,metadata)
                        raise ExecutionStopped('process_cleanup_unconfirmed') from None
                    metadata.update(returncode=process.returncode, reaped=True)
                    _record(meta_path, metadata)
                    out.flush();err.flush();os.fsync(out.fileno());os.fsync(err.fileno())
                    if isinstance(exc, (subprocess.TimeoutExpired, ExecutionStopped)):
                        raise ExecutionStopped('process_timeout_unknown' if not interrupted else 'process_interrupted_unknown') from None
                    raise
                metadata.update(status='exited', returncode=process.returncode, reaped=True)
                _record(meta_path, metadata)
                out.flush();err.flush();os.fsync(out.fileno());os.fsync(err.fileno())
        return subprocess.CompletedProcess(argv, process.returncode,
            stdout_path.read_text(errors='replace'), stderr_path.read_text(errors='replace'))
    finally:
        if process is not None and process.stdin is not None and not process.stdin.closed:
            process.stdin.close()
        for sig,handler in old_handlers.items():signal.signal(sig, handler)
