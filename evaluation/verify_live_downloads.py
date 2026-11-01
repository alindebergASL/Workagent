"""Download only actual model-tool exports; no export creation/provider effects."""
import argparse,json,os
from pathlib import Path
from workagent.db import Database
from workagent.service import Service,Principal
from study_controller import canonical,digest
from install_recipient_funding import OUT
from amend_gateway_recovery import exact_bytes


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser();parser.add_argument('--trajectory',required=True);parser.add_argument('--run',required=True)
    args=parser.parse_args()
    state=json.loads((OUT/'campaign'/args.trajectory/'application.json').read_bytes())
    assert state['current_run']==args.run
    b=json.loads((OUT/'live-bindings.private.json').read_bytes())[args.trajectory]
    db=Database(b['database_url']);service=Service(db);principal=Principal(state['principal'])
    with db.transaction() as c:
        c.execute('SET TRANSACTION READ ONLY')
        rows=c.execute("SELECT e.id FROM artifact_exports e JOIN tool_attempts t ON t.id=e.data->>'tool_attempt_id' AND t.workspace_id=e.workspace_id WHERE t.run_id=%s ORDER BY e.id",(args.run,)).fetchall()
    assert rows,'no actual model-created exports yet'
    directory=OUT/'verified-downloads'/args.trajectory/args.run
    directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    receipts=[]
    for row in rows:
        manifest,raw=service.download_export(principal,state['workspace'],row['id'])
        # Fresh service reads the same immutable exact export under live access.
        again,raw_again=Service(Database(b['database_url'])).download_export(principal,state['workspace'],row['id'])
        assert manifest==again and raw==raw_again and digest(raw)==manifest.blob.sha256 and len(raw)==manifest.blob.byte_length
        output=directory/(digest(raw)+'.bin');exact_bytes(output,raw)
        receipts.append(dict(export_id=row['id'],sha256=digest(raw),bytes=len(raw),
            path=str(output.relative_to(OUT)),manifest=manifest.model_dump(mode='json'),
            fresh_service_exact_readback=True))
    report=dict(trajectory=args.trajectory,run=args.run,downloads=receipts,provider_io=0,
        exports_created_by_verifier=0,evidence_level='actual_model_tool_export_download_SQL_service_not_browser')
    exact_bytes(directory/'receipt.json',(canonical(report)+'\n').encode())
    print(canonical(dict(downloads=len(receipts),bytes=sum(r['bytes'] for r in receipts),sha256=[r['sha256'] for r in receipts],provider_io=0)))

if __name__=='__main__':main()
