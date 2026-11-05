"""Parent-run evaluator-only64→65 publication. No SQL/install/provider path."""
import argparse
from copy import deepcopy
import json
import os
from pathlib import Path
import sqlite3
import amend_retained_read as A
import amend_bounded_phase as B
from baseline_observation import RECOVERY_POLICY

PRIOR='ddc0c796b4f89183e1153c50a16cb4091acc5705f72fa24d729b82115b02cf03'
SOURCE=B.SOURCE
CONSUMER=B.CONSUMER
CHANGED={'evaluation/baseline_observation.py','evaluation/amend_baseline_observer.py','evaluation/test_baseline_observation.py'}
ADDED=set()
check,save,digest,canonical=A.check,A.save,A.digest,A.canonical


def compose(root,out,old,code):
    B.identity(root)
    check(old['execution_sources']['B1']==SOURCE and old['execution_sources']['M1']==SOURCE,'active_product')
    changed={n for n,h in old['files'].items() if digest((root/n).read_bytes())!=h}
    check(changed==CHANGED,'exact_evaluator_delta')
    check(set(code['files'])==CHANGED|ADDED,'exact_evaluator_files');A.verify_files(root,code['files'])
    m=deepcopy(old);m['files'].update(code['files']);m['binding_name']='baseline-observer-generic-v1'
    m['evaluator_transition']=dict(predecessor_manifest=str((out/'PREDECESSOR.json').relative_to(root)),predecessor_sha256=PRIOR,
        files=code['files'],source_sha256=SOURCE,consumer_sha256=CONSUMER,sql_install=False,provider_io=0,
        recovery_policy=RECOVERY_POLICY)
    # Preserve all existing product/schema/release/funding lineage objects exactly.
    for key in ('execution_sources','migration_inventory','migration_additions','release_transition','successor','file_input_continuation'):
        check(m[key]==old[key],'preserved_lineage:'+key)
    return m


def prepare(root,out,code_path):
    import study_source_amendment as AM
    raw=AM.MANIFEST.read_bytes();check(digest(raw)==PRIOR and AM.APPROVAL.read_text().strip()==PRIOR,'active64_required')
    check(not out.exists() and out.is_relative_to(root),'fresh_output');out.mkdir(mode=0o700,parents=True)
    A.exact(out/'PREDECESSOR.json',raw);A.exact(out/'PREDECESSOR.approved.sha256',AM.APPROVAL.read_bytes());old=json.loads(raw)
    code=json.loads(code_path.read_bytes());m=compose(root,out,old,code)
    campaign=root/'.local/batch3/b35c/live-study/campaign'
    with A.campaign_lock(campaign):
        before=A.campaign_state(campaign)
        env,plans,_=B.bootstrap_copies(root,out,m,old,campaign,before)
        # No jailed file changed; all applications stay byte-identical.
        apps=[json.loads((campaign/name).read_bytes()) for name in before['files'] if name.endswith('/application.json')]
        check(len(apps)==2 and all(x['environment']==env for x in apps),'exact_two_application_environments')
        # Bind current pending application/bridge identities without compiling a study run whitelist.
        from observe_live_study import select_pending
        pending=[x for x in apps if x['variant']=='B0' and x['current_run'] and x['episode']==x['collected']+1]
        check(len(pending)==1,'one_pending_b0_application')
        b0=pending[0]
        with sqlite3.connect('file:'+str(campaign/'bridge.sqlite')+'?mode=ro',uri=True) as b, sqlite3.connect('file:'+str(campaign/'controller.sqlite')+'?mode=ro',uri=True) as c:
            b.row_factory=c.row_factory=sqlite3.Row
            old_receipt,payload=select_pending(b,c,b0['blind_id'])
        check(payload['admitted']['run_id']==b0['current_run'] and payload['episode']==b0['episode']
            and payload['trajectory']['variant']=='B0','current_b0_pending_execute')
        check(A.campaign_state(campaign)==before,'prepare_changed_state')
        m['evaluator_transition']['campaign_state']=before
        save(out/'CANDIDATE.json',m);save(out/'TRIAL.json',dict(candidate_sha256=digest((out/'CANDIDATE.json').read_bytes()),
            cold_mapping=True,stores=len(plans),copied_constructors=True,all_prior_rows_preserved=True,
            environment_unchanged=True,product_unchanged=True,pg_calls=0,provider_io=0))
        A.exact(out/'CODE_FILES.json',code_path.read_bytes())
    A.progress('evaluator65_prepared_no_original_mutation')


def load(root,out):
    raw=(out/'CANDIDATE.json').read_bytes();m=json.loads(raw);old_raw=(out/'PREDECESSOR.json').read_bytes()
    check(digest(old_raw)==PRIOR,'predecessor');old=json.loads(old_raw)
    code=json.loads((out/'CODE_FILES.json').read_bytes());expected=compose(root,out,old,code)
    expected['bindings']=m['bindings'];expected['evaluator_transition']['campaign_state']=m['evaluator_transition']['campaign_state']
    check(m==expected,'candidate_shape');A.verify_files(root,m['files'])
    return raw,m


def state(root,out):
    import study_source_amendment as AM
    raw,m=load(root,out);before=m['evaluator_transition']['campaign_state']
    campaign=root/'.local/batch3/b35c/live-study/campaign'
    check(A.campaign_state(campaign)==before,'pending_state_changed')
    actual=(digest(AM.MANIFEST.read_bytes()),AM.APPROVAL.read_text().strip())
    phases=[(PRIOR,PRIOR),(digest(raw),PRIOR),(digest(raw),digest(raw))]
    check(actual in phases,'ordered_publication_state')
    return phases.index(actual)


def backup_state(campaign,out,before):
    for name in ('controller','bridge'):
        dest=out/'backups'/(name+'.sqlite');dest.parent.mkdir(exist_ok=True)
        if not dest.exists():
            with sqlite3.connect('file:'+str(campaign/(name+'.sqlite'))+'?mode=ro',uri=True) as c, sqlite3.connect(dest) as copy:c.backup(copy)
        check(A.sqlite_tables(dest)==before[name],'backup_sqlite_drift')
    for name,h in before['files'].items():
        raw=(campaign/name).read_bytes();check(digest(raw)==h,'backup_file_drift');A.exact(out/'backups/state'/name,raw)
    A.fsync_dir(out/'backups')
    save(out/'BACKUPS.json',{str(p.relative_to(out)):digest(p.read_bytes()) for p in sorted((out/'backups').rglob('*')) if p.is_file()})


def publish(root,out,review):
    import study_source_amendment as AM
    raw,m=load(root,out);trial=(out/'TRIAL.json').read_bytes();proof=json.loads(trial)
    check(proof['candidate_sha256']==digest(raw) and proof['all_prior_rows_preserved'] and proof['product_unchanged']
        and proof['environment_unchanged'] and proof['pg_calls']==proof['provider_io']==0,'copy_proof')
    A.review(root,review,raw,trial)
    campaign=root/'.local/batch3/b35c/live-study/campaign'
    with A.campaign_lock(campaign):
        phase=state(root,out)
        if not (out/'BACKUPS.json').exists():
            check(phase==0,'backup_before_publication');backup_state(campaign,out,m['evaluator_transition']['campaign_state'])
        for name,h in json.loads((out/'BACKUPS.json').read_bytes()).items():check(digest(A.safe(out,name).read_bytes())==h,'backup_drift')
        if phase==0:A.atomic_replace(AM.MANIFEST,raw)
        check(state(root,out) in (1,2),'manifest_phase')
        if state(root,out)==1:A.atomic_replace(AM.APPROVAL,(digest(raw)+'\n').encode())
        check(state(root,out)==2 and AM.load()==m,'active_readback')
        from install_recipient_funding import mapping
        check(len(mapping()[0])==12,'cold_active_mapping')
        save(out/'ACTIVATED.json',dict(candidate_sha256=digest(raw),product_unchanged=True,sql_install=False,provider_io=0))


def main():
    os.umask(0o077)
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    q=p.add_subparsers(dest='action',required=True)
    q.add_parser('prepare').add_argument('--code-manifest',type=Path,required=True)
    q.add_parser('publish').add_argument('--review',type=Path,required=True)
    q.add_parser('readback')
    a=p.parse_args();root=a.root.resolve();out=a.out.resolve();check(out.is_relative_to(root) and out!=root,'safe_output')
    if a.action=='prepare':prepare(root,out,a.code_manifest)
    elif a.action=='publish':publish(root,out,a.review)
    else:print(canonical(dict(phase=state(root,out),no_pg=True)),flush=True)

if __name__=='__main__':main()
