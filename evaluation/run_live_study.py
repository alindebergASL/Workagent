"""Official study driver. Source release lock remains mandatory; never a demo.

Sequential trajectory phases retain unknown requests and failed operations. No
implicit credential discovery, automatic top-up, reset, or unresolved resend.
"""
import argparse
from decimal import Decimal
import fcntl
import json
import os
from pathlib import Path
import sys

from study_transport import require_live_release
from study_diagnostic import ProductAdapter
from study_controller import Controller, canonical, Hold
from install_recipient_funding import mapping, install_gate, issue_phase, OUT
from live_tool_authority import install as install_tools


class LiveAdapter(ProductAdapter):
    def __init__(self,directory,*,bindings,plans,credential,phase_amount):
        self.plans,self.phase_amount=plans,phase_amount
        super().__init__(directory,None,live_bindings=bindings,credential=credential)

    def call(self,key,operation,payload):
        # Never re-enter even the installation path for a sent/unknown bridge key.
        previous=self.db.execute('SELECT payload FROM receipts WHERE key=?',(key,)).fetchone()
        if previous:
            return super().call(key,operation,payload)
        trial=payload['blind_id'] if operation=='open_trajectory' else payload['trajectory']['id']
        binding=self.live_bindings[trial]
        if operation=='open_trajectory':
            # Incremental fixed-target authority only when that trajectory begins.
            # It is not a spend target or a generation/task cap. All12/72 remain.
            issue_phase(self.plans[trial],binding,1,self.phase_amount)
        if operation=='execute':
            state=json.loads((self.directory/trial/'application.json').read_text())
            assert state['current_run']==payload['admitted']['run_id'] and state['episode']==payload['episode']
            install_gate(self.plans[trial],binding)  # exact identity/function readback
            install_tools(binding,state,self.directory/trial/'tool-intents')
        return super().call(key,operation,payload)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--credential-file',type=Path,required=True)
    parser.add_argument('--initial-phase-usd',type=Decimal,required=True)
    parser.add_argument('--checkpoint-after-episodes',type=int)
    args=parser.parse_args()
    require_live_release()  # before authority, credential access or bridge opening
    assert args.initial_phase_usd.is_finite() and args.initial_phase_usd>0
    plans,bindings=mapping()
    # The supplied path must be exactly the retained approved file reference.
    reference='file:'+str(args.credential_file.resolve())
    assert all(g['responses']['secret_reference']==reference for b in bindings.values() for g in (b['grant'],b['other_grant']))
    assert args.credential_file.is_file() and args.credential_file.stat().st_mode & 0o077 == 0
    credential=args.credential_file.read_text().strip()
    assert credential and not any(c.isspace() for c in credential)
    directory=OUT/'campaign'
    directory.mkdir(mode=0o700,exist_ok=True)
    with (directory/'controller.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        adapter=LiveAdapter(directory,bindings=bindings,plans=plans,credential=credential,phase_amount=args.initial_phase_usd)
        controller=Controller(directory/'controller.sqlite',adapter,mode='official_api')
        try:
            summary=controller.run(stop_after=args.checkpoint_after_episodes)
            path=directory/('summary-'+str(summary['collected_episodes'])+'.json')
            raw=canonical(summary)+'\n'
            if path.exists():assert path.read_text()==raw
            else:
                with path.open('x') as f:f.write(raw)
            if summary['collected_episodes']==72 and not (directory/'evaluation-packets').exists():
                controller.export_evaluation(directory/'evaluation-packets')
            print(canonical({k:v for k,v in summary.items() if k!='episodes'}))
        finally:
            controller.close();adapter.close()

if __name__=='__main__':main()
