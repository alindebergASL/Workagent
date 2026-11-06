"""Materialize every source paragraph/row, retaining all literal requirements.
No 'implemented' result is inferred from a plan or a prior PASS label.
"""
from pathlib import Path
import json
import re
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from harness import digest,canonical,write_new
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/evidence/batch3-b35b'
PLAN=ROOT/'docs/plans/2026-10-23-workagent/batch-3/evaluation-plan.md'
APPENDIX=ROOT/'docs/plans/2026-10-23-workagent/batch-3/implementation-plan.md'
PRIOR=ROOT/'docs/evidence/batch3-b35a/EVALUATION_MATRIX.md'


def build():
    prior=json.loads((ROOT/'docs/evidence/batch3-b35a/SOURCE_MANIFEST.json').read_text())
    assert all(digest((ROOT/p).read_bytes())==h for p,h in prior.items())
    inherited={}
    for chunk in re.split(r'(?m)^## ',PRIOR.read_text())[1:]:
        title,*rest=chunk.splitlines()
        if title.startswith(('§5 correction row','§7 safety row')):
            requirement=next(x for x in rest if x.strip())
            inherited[requirement]={'heading':title,'tests':re.findall(r'`(tests\.[^`]+)`',chunk)}
    assert len(inherited)==19
    rows=[];section='preamble';family=None;code=False
    for number,line in enumerate(PLAN.read_text().splitlines(),1):
        if line.startswith('## '):section=line[3:];family=None
        if line.startswith('### ') and re.match(r'### [A-G]\.',line):family=line[4]
        if line.startswith('```'):code=not code;continue
        if not line.strip() or line.startswith('#') or code or re.fullmatch(r'\|[-| ]+\|',line):continue
        if section.startswith('1.') or section=='Sources of evaluation design':status='question_not_measured'
        elif section.startswith('2.'):status='transport_design_frozen_live_SQL_treatment_pending'
        elif section.startswith('3.'):status='offline_custody_verified_real_evidence_amendment_pending'
        elif section.startswith('4.'):status='partial_synthetic_fixture_only_live_and_literal_adversaries_pending'
        elif section.startswith('5.'):status='offline_sequence_only_real_longitudinal_pending'
        elif section.startswith('6.'):status='metric_preregistered_not_live_measured'
        elif section.startswith('7.'):status='safety_required_not_new_live_proof'
        elif section.startswith('8.'):status='current_ledger_reconciled_live_unfunded'
        elif section.startswith('9.'):status='offline_report_materialized_live_results_missing'
        else:status='controlling_context_preserved'
        text=line.removeprefix('- ').strip()
        evidence=['PREREGISTRATION.md','AMENDMENT_01.md']
        reuse=None
        if text in inherited:
            reuse=inherited[text]
            status='prior_synthetic_mechanism_reused_live_unmeasured'
            evidence+=['../batch3-b35a/EVALUATION_MATRIX.md#'+reuse['heading'].replace(' ','-'),'../batch3-b35a/SOURCE_MANIFEST.json']
        if section.startswith('8.'):evidence+=['ledger/REPORT.md','ledger/current-reconciliation.json','ledger/proposed-tranche.json']
        row={'id':f'EP-L{number:03d}','source_line':number,'section':section,'family':family,
             'requirement':line,'status':status,'evidence':evidence,'prior_test_nodes':reuse['tests'] if reuse else [],
             'live':False,'next_owner':'t_82b30c02' if family in ('A','B',None) else 't_9cfa8070' if family in ('C','D') else 't_da120c26'}
        rows.append(row)
    for number,line in enumerate(APPENDIX.read_text().splitlines(),1):
        if number in (369,370,371,372,376,377,378):
            private=number>=376
            rows.append({'id':f'IMP-L{number}','source_line':number,'section':'T7' if private else 'T6','family':None,
             'requirement':line,'status':'conditional_private_pilot_unmet_not_preparation_blocker' if private else 'prior_client_mechanisms_reused_live_usefulness_pending',
             'evidence':['../batch3-b35a/ACCEPTANCE.md','AMENDMENT_01.md'],
             'prior_test_nodes':[],'live':False,'next_owner':'t_bb46e05f' if private else 't_82b30c02'})
    assert len([r for r in rows if r['prior_test_nodes']])==19
    assert len([r for r in rows if r['section']=='T7'])==3
    result={'source_sha256':digest(PLAN.read_bytes()),'appendix_sha256':digest(APPENDIX.read_bytes()),
            'scope':'every nonblank nonheading non-code line of evaluation-plan plus all T6/T7 bullets; table headers retained',
            'rows':rows,'row_count':len(rows),'inherited_correction_rows':8,'inherited_safety_rows':11,
            'prior_source_hashes_verified':len(prior),'whole_batch3_acceptance':False,'live_trials':0,
            'authority_precedence':'historical planning-only prohibitions superseded by DEVELOPMENT_AUTHORITY and task;100USD/private consent remain'}
    write_new(OUT/'ACCEPTANCE_MATRIX.json',canonical(result))
    md=['# Full evaluation/correction/safety/T6/T7 matrix','',f'{len(rows)} literal source rows retained;19 correction/safety rows link unchanged predecessor nodes. No live success is inferred.','',
        'Every source row is present, including explanatory/table header rows. Source hashes and machine-readable IDs are in ACCEPTANCE_MATRIX.json. Prior synthetic proof remains separately scoped; no new full SQL recall, live usefulness, overnight or private pilot is claimed.','']
    for r in rows:
        md += ['## '+r['id']+' — '+r['section'],'',r['requirement'],'','**Disposition:** `'+r['status']+'`. Next owner: `'+r['next_owner']+'`.',
               'Evidence: '+', '.join('`'+p+'`' for p in r['evidence'])+'.','']
        if r['prior_test_nodes']:md+=['Prior retained test nodes (not rerun here): '+', '.join('`'+n+'`' for n in r['prior_test_nodes'])+'.','']
    write_new(OUT/'ACCEPTANCE_MATRIX.md','\n'.join(md).encode())
    print(json.dumps({k:v for k,v in result.items() if k!='rows'}))

if __name__=='__main__':build()
