"""Deterministic actor-data-only adapter; no evaluator/future inputs or live APIs."""
import argparse
import json
import os
from pathlib import Path
from .db import Database
from .models import *
from .service import Service, Principal, encoded, canonical


def seed(dsn, records, workspace_id='local-workspace', principal_id='local-human'):
    """Administrative provisioning only. Existing scope is never overwritten."""
    with Database(dsn).transaction() as c:
        w=Workspace(id=workspace_id,name='Private fixture workspace',owner_id=principal_id)
        c.execute('INSERT INTO workspaces(id,data) VALUES (%s,%s)',(w.id,encoded(w)))
        c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,%s,'owner')",(w.id,principal_id))
        for record in records:
            source=Source(id=record['id'],workspace_id=w.id,title=record['title'],external_version=str(record['version']),observed_at=now())
            c.execute('INSERT INTO sources(workspace_id,id,data,content) VALUES (%s,%s,%s,%s)',(w.id,source.id,encoded(source),encoded(record['content'])))
            c.execute('INSERT INTO source_access(workspace_id,source_id,principal_id) VALUES (%s,%s,%s)',(w.id,source.id,principal_id))
    return w


def generate(sources):
    rows=[]; unknowns=[]; notes=[]
    for source in sources:
        content=source['content']
        candidate=content.get('rows',[])
        if isinstance(candidate,list):
            rows.extend(candidate)
        unknowns.extend(str(x) for x in content.get('unknowns',[]) if isinstance(x,str))
        if isinstance(content.get('protected_note'),str):
            notes.append(content['protected_note'])
    usable=[r for r in rows if isinstance(r,dict) and isinstance(r.get('id'),str)
            and type(r.get('owner_recorded')) is bool and type(r.get('next_action_recorded')) is bool]
    malformed = len(usable) != len(rows)
    by_id = {}
    conflicts = set()
    for row in usable:
        if row['id'] in by_id and canonical(by_id[row['id']]) != canonical(row):
            conflicts.add(row['id'])
        else:
            by_id[row['id']] = row
    usable = [row for id, row in by_id.items() if id not in conflicts]
    missing=[r['id'] for r in usable if not r['owner_recorded'] or not r['next_action_recorded']]
    unresolved=[]
    if conflicts:
        unresolved.append('Conflicting duplicate case IDs excluded from quantification: '+', '.join(sorted(conflicts))+'.')
    if not usable:
        unresolved.append('No usable intake rows supplied; the baseline cannot be quantified.')
    if malformed:
        unresolved.append('Some supplied rows have unknown owner/next-action indicators and were not quantified.')
    evidence=f"{len(missing)} of {len(usable)} usable personal cases lack an owner or a next action (union, not a sum). Cases: {', '.join(missing) or 'none'}."
    unknowns=list(dict.fromkeys(unknowns+['No time-saved data collected.','No evidence of a causal effect.']))
    plan=Body(title='Private working plan',blocks=[
        Block(block_id='recommendation',kind='paragraph',text='Test one owner-and-next-action check in your own intake review; do not automate or share yet.'),
        Block(block_id='evidence',kind='paragraph',text=evidence),
        Block(block_id='next-action',kind='checklist',text='Choose the next personal case. Record one owner, one concrete next action and an observation before comparing outcomes.'),
        *[Block(block_id=f'protected-{i}',kind='protected_note',text=note) for i,note in enumerate(notes)],
        Block(block_id='unknowns',kind='paragraph',text='Unknowns: '+' '.join(unknowns+unresolved)),
        Block(block_id='scope',kind='paragraph',text='Private draft from selected current source references only. No calendar write, sharing, causal claim or external task effect occurred.')])
    checklist=Body(title='Reusable intake review checklist',blocks=[
        Block(block_id='owner',kind='checklist',text='Is a single accountable owner recorded? If not, identify one before continuing.'),
        Block(block_id='action',kind='checklist',text='Is the next concrete action recorded? If not, write one with an observable completion condition.'),
        Block(block_id='measure',kind='checklist',text='Record what happened and any effort measurement; compare only with collected evidence.'),
        Block(block_id='review',kind='checklist',text='Review your private working plan without modifying human-maintained source records.')])
    return [plan,checklist],unresolved


def work_once(service,p,ws,run_id):
    cap=service.claim_run(p,ws,run_id)
    result=run_claimed(service,cap)
    from .dispatcher import Dispatcher
    Dispatcher(service).reconcile(ws,run_id)
    return result


# Backward-compatible trusted-process seam for the parent integration.
run_fixture = work_once


def run_claimed(service,cap):
    from .broker import Broker
    context=service.worker_context(cap)
    r,a,sources,base=service.worker_inputs(cap)
    Broker(service,cap).call('get_assignment', {
        'schema_version':'workagent/v1', 'request_id':new_id(),
        'workspace_id':cap.workspace_id, 'assignment_id':a.id})
    # Local deterministic compute consumes the assembled permitted evidence, not
    # a second broad source fetch or instructions discovered in customer content.
    sources=[{'content':source['content']} for source in context['sources']]
    bodies,unresolved=generate(sources)
    if r.kind=='revision':
        # Fixture adapter creates a reviewable separate proposal, not a simulated LLM result.
        blocks=[b for b in base.body.blocks if b.block_id!='fixture-revision-request']
        bodies=[Body(title=base.body.title,blocks=blocks+[Block(block_id='fixture-revision-request',kind='paragraph',text='Fixture revision request for human review: '+r.instruction)])]
    return service.complete_run(cap,bodies,unresolved,Command(schema_version='workagent/v1',request_id=new_id(),command_id='fixture-complete:'+r.id))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='operation',required=True)
    s=sub.add_parser('seed'); s.add_argument('--records',type=Path,required=True)
    s.add_argument('--workspace',default='local-workspace'); s.add_argument('--principal',default='local-human')
    w=sub.add_parser('work'); w.add_argument('--workspace',required=True); w.add_argument('--run',required=True)
    w.add_argument('--principal',default='local-human')
    args=parser.parse_args()
    if os.environ.get('LOCAL_TEST_MODE')!='true':
        parser.error('LOCAL_TEST_MODE=true required')
    if args.operation=='seed':
        records=json.loads(args.records.read_text())
        print(seed(os.environ['MIGRATION_DATABASE_URL'],records,args.workspace,args.principal).model_dump_json())
    else:
        db=Database(); db.check_runtime_role()
        print(work_once(Service(db),Principal(args.principal),args.workspace,args.run).model_dump_json())

if __name__=='__main__':
    main()
