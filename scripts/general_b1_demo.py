"""Executable zero-inference CLI acceptance using fresh disposable PostgreSQL.

First provision with backend/dev_db.py and source its scratch env file. This seeds
only an empty synthetic workspace; do not point it at a live/shared DB.
"""
import argparse
import json
import os
import subprocess
import sys
from uuid import uuid4


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--controlled',action='store_true',required=True)
    parser.parse_args()
    from pathlib import Path
    backend=str(Path(__file__).resolve().parents[1]/'backend')
    # scripts/workagent.py otherwise shadows the real package for file invocation.
    sys.path.insert(0,backend)
    os.environ['PYTHONPATH']=backend
    from workagent.db import Database
    from workagent.fixture import seed
    if os.environ.get('LOCAL_TEST_MODE')!='true':
        parser.error('LOCAL_TEST_MODE=true required')
    db=Database(); db.check_runtime_role()
    with db.transaction() as c:
        name=c.execute('SELECT current_database() AS name').fetchone()['name']
        if not name.startswith('workagent_test_'):
            parser.error('Disposable workagent_test_ database required')
        if c.execute('SELECT count(*) AS n FROM workspaces').fetchone()['n']:
            parser.error('Fresh empty disposable database required')
    workspace='b1-demo-'+str(uuid4())
    seed(os.environ['MIGRATION_DATABASE_URL'],[],workspace)
    def cli(*args):
        completed=subprocess.run([sys.executable,'-m','workagent.prompt_cli','--controlled',*args],
                                 capture_output=True,text=True,check=True,env=os.environ)
        return json.loads(completed.stdout)
    first=cli('prompt','Help me think about next week')
    cid=first['conversation']['id']
    second=cli('continue',cid,'Keep it short')
    reopened=cli('inspect',cid)  # independent interpreter, only PostgreSQL carries state
    assert reopened=={k:v for k,v in second.items() if k not in ('command_id','submitted_work_version')}
    assert [m['text'] for m in reopened['messages'] if m['author_kind']=='human']==[
        'Help me think about next week','Keep it short']
    delegated=cli('delegate',cid,'Carry this forward','--criterion','Review together')
    final=cli('inspect',cid)
    assert final['assignment_ids']==[delegated['id']]
    assert delegated['state']=='paused' and delegated['run_ids']==[]
    assert all(r['assignment_id'] is None and r['state']=='ready' for r in final['runs'])
    assert len(final['messages'])==4
    with db.transaction() as c:
        attempts=c.execute('SELECT count(*) AS n FROM provider_attempts').fetchone()['n']
        sources=c.execute('SELECT count(*) AS n FROM sources').fetchone()['n']
        assignments=c.execute('SELECT count(*) AS n FROM assignments').fetchone()['n']
        pending=c.execute('SELECT count(*) AS n FROM run_dispatches WHERE acknowledged_at IS NULL').fetchone()['n']
    assert (attempts,sources,assignments,pending)==(0,0,1,0)
    print(json.dumps({'mode':'controlled','usefulness':'unverified','workspace_id':workspace,
        'conversation_id':cid,'run_ids':[r['id'] for r in final['runs']],
        'message_ids':[m['id'] for m in final['messages']], 'assignment_id':delegated['id'],
        'message_count':len(final['messages']),'retained_after_process_restart':True,
        'provider_attempt_count':attempts,'source_count':sources,'assignment_count':assignments,
        'pending_dispatch_count':pending,'assistant_text':final['messages'][-1]['text']},indent=2))


if __name__=='__main__':
    main()
