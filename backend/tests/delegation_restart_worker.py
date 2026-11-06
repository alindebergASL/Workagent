"""Controlled parent-worker process used only by disposable B3.4b tests."""
import json
import os
from pathlib import Path
import sys
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_delegation_worker_pg import verifier,draft
from workagent.db import Database
from workagent.service import Service,Principal


def main():
    spec_path=Path(sys.argv[1]); mode=sys.argv[2]; spec=json.loads(spec_path.read_text())
    assert '/workagent_test_' in os.environ['DATABASE_URL']
    s=Service(Database());p=Principal(spec['principal_id']);ws=spec['workspace_id'];rid=spec['run_id']
    ctx=(s,p,ws,[],os.environ['MIGRATION_DATABASE_URL'])
    fake=AlphaProvider([*spec['children'],verifier(0),verifier(1),draft,
                       {'kind':'reply','text':'Verified comparison: West 120 seconds, East 180 seconds; East is 60 seconds higher.'}])
    state_path=spec_path.with_suffix('.provider.json')
    if state_path.exists():
        prior=json.loads(state_path.read_text());fake.responses=prior['responses'];fake.calls=prior['calls']
    def save(state):
        state_path.write_text(json.dumps({'responses':fake.responses,'calls':fake.calls}))
        spec_path.with_suffix('.result.json').write_text(json.dumps({'pid':os.getpid(),'mode':mode,'state':state,'calls':len(fake.calls)}))
    if mode=='interrupt':
        def crash(name):
            if name=='after_tool_result':raise SystemExit(71)
        try:
            worker(ctx,fake,spec_path.parent/'worker',hook=crash).work(p,ws,rid)
        except SystemExit:
            save('interrupted_after_child_observation');raise
        raise AssertionError('interruption hook not reached')
    result=finish_safe_visits(ctx,worker(ctx,fake,spec_path.parent/'worker'),rid)
    assert result.state=='ready'
    calls=list(fake.calls)
    assert worker(ctx,fake,spec_path.parent/'worker').work(p,ws,rid).state=='ready' and fake.calls==calls
    save(result.state)

if __name__=='__main__':main()
