#!/usr/bin/env python3
"""Run the ordinary continuous consumer with an opt-in interruption-only probe.

No response alteration, evaluator answers, manual worker ticks or new state engine.
Create PROBE/arm before the turn to pause AFTER a final provider identity is durably
retained, but BEFORE its result/publication. The controller may then kill this
specific PID and restart the same command without rearming. Authority and private
state arguments are forwarded to the normal explicit live CLI. Do not use against
production or protected review state.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import signal
import sys


def main():
    parser=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    parser.add_argument('--probe-dir',required=True,type=Path)
    parser.add_argument('--lock-file',required=True,type=Path)
    args,worker_args=parser.parse_known_args()
    if '--serve' not in worker_args or '--general-responses' not in worker_args:
        parser.error('probe requires the ordinary explicit continuous general consumer')
    probe=args.probe_dir.resolve();probe.mkdir(parents=True,exist_ok=True,mode=0o700)
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
    from workagent.responses_ledger import Ledger
    from workagent.responses_dispatcher import main as worker_main
    original=Ledger.retain

    def retain(self,request,kind,data):
        result=original(self,request,kind,data)
        if request.phase=='final' and kind=='identity':
            try: (probe/'arm').rename(probe/'consumed')
            except FileNotFoundError: return result
            # No credentials, provider IDs or receipts in the probe's notification.
            fd=os.open(probe/'paused.json',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
            with os.fdopen(fd,'w') as f:
                json.dump({'pid':os.getpid(),'checkpoint':'durable_final_identity_before_result',
                    'request_sha256':request.sha256},f)
            os.kill(os.getpid(),signal.SIGSTOP)
        return result

    Ledger.retain=retain
    sys.argv=['responses_dispatcher',*worker_args]
    with args.lock_file.open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        worker_main()


if __name__=='__main__':
    main()
