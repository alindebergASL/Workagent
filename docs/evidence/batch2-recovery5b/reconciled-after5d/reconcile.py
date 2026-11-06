"""Offline, read-only evidence reconciliation; only new outputs in this directory.
Run from repository root: python3 docs/evidence/batch2-recovery5b/reconciled-after5d/reconcile.py
No provider, database, browser, service or product-source operation.
"""
import ast
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path.cwd()
OUT = Path(__file__).resolve().parent
BASE = Path('docs/evidence/batch2-recovery5b')
CURRENT = Path('docs/evidence/batch2-recovery5d/poll-correction/source-manifest.json')
PARENT = Path('docs/evidence/batch2-parent-reconciliation-after5d/acceptance-rollup.json')
DETAIL = Path('docs/plans/2026-10-23-workagent/batch-2/IMPLEMENTATION.md')
PLAN = Path('docs/plans/2026-10-23-workagent-next-two-batches.md')

def digest(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def load(p):
    return json.loads(Path(p).read_text())

def ref(p):
    p = Path(p).resolve()
    assert p.is_relative_to(ROOT), p
    assert p.is_file(), p
    return {'path': str(p.relative_to(ROOT)), 'sha256': digest(p)}

current = load(CURRENT)
assert len(current) == 611
assert digest(CURRENT) == '194d317f63fdf7fea4dadc38c6a6377a7196a8c02c74fc8da9db230f8b205c07'
assert all(digest(p) == h for p, h in current.items())
rows = load(PARENT)['rows']
assessments = load(OUT / 'row-assessments.json')
expected = [f'A{i:02}' for i in range(1, 36)] + [f'P{i}' for i in range(1, 9)]
assert [r['id'] for r in rows] == expected
assert set(assessments) == set(expected)

# Compare verbatim requirement/case/evidence text, not stale matrix summaries.
requirements = {}
for p in (DETAIL, PLAN):
    for number, line in enumerate(p.read_text().splitlines(), 1):
        m = re.match(r'^\|\s*(A\d+|P\d+)\s*\|', line)
        if not m:
            continue
        fields = [x.strip() for x in line.strip().strip('|').split('|')]
        key = fields[0]
        if key.startswith('A'):
            key = f'A{int(key[1:]):02}'
        if key in expected:
            requirements[key] = {'source': ref(p), 'line': number, 'verbatim': line, 'fields': fields[1:]}
assert set(requirements) == set(expected)
for row in rows:
    fields = requirements[row['id']]['fields']
    assert fields[:2] == [row['case'], row['required']], row['id']
    if row['id'].startswith('A'):
        assert fields[2] == row['evidence_required'], row['id']

# Keep exact source origin/delta boundaries. api.py is NOT unchanged since 5b.
origins = {}
for tag, path in {
    'recovery4': 'docs/evidence/batch2-recovery4/final-source-manifest.json',
    'recovery5a': 'docs/evidence/batch2-recovery5a/source-manifest.json',
    'recovery5b': 'docs/evidence/batch2-recovery5b/source-manifest.json',
    'recovery5d_candidate2': 'docs/evidence/batch2-recovery5d/candidate2-source-manifest.json',
}.items():
    old = load(path)
    changed = [{'path': p, 'before': h, 'current': current.get(p)} for p, h in old.items() if current.get(p) != h]
    origins[tag] = {'manifest': ref(path), 'files': len(old), 'changed_or_removed': changed,
                    'added': {p: h for p, h in current.items() if p not in old}}

registry = {}
def evidence(p):
    r = ref(p)
    registry[r['path']] = r
    return r

# Verify retained manifests against bytes, including red receipts. Some manifests
# use basename keys and some use repository-relative paths.
preservation = []
for path in [
    'docs/evidence/batch2-recovery5a/evidence-manifest.json',
    'docs/evidence/batch2-recovery5b/evidence-manifest.json',
    'docs/evidence/batch2-recovery5c/evidence-manifest.json',
    'docs/evidence/batch2-recovery5d/evidence-manifest.json',
    'docs/evidence/batch2-recovery5d/poll-correction/evidence-manifest.json',
]:
    m = load(path)
    entries = m.get('files', m)
    checked = []
    for name, value in entries.items():
        h = value.get('sha256') if isinstance(value, dict) else value
        assert isinstance(h, str) and re.fullmatch('[a-f0-9]{64}', h), (path, name)
        choices = [Path(name), Path(path).parent / name]
        matches = [p for p in choices if p.is_file() and digest(p) == h]
        assert matches, ('retained evidence mismatch', path, name)
        checked.append(ref(matches[0]))
    preservation.append({'manifest': evidence(path), 'verified_count': len(checked), 'files': checked})

common = [
    CURRENT, PARENT,
    'docs/evidence/batch2-parent-reconciliation-after5d/parent-verification.json',
    'docs/evidence/batch2-recovery5d/poll-correction/independent-review.json',
    'docs/evidence/batch2-recovery5d/poll-correction/frontend.xml',
    'docs/evidence/batch2-recovery5d/poll-correction/POLL-CORRECTION-HANDOFF.md',
    'docs/evidence/batch2-recovery5d/independent-rereview.json',
    'docs/evidence/batch2-recovery5d/candidate1-delta.patch',
    'docs/evidence/batch2-recovery5b/independent-correction-review.md',
    'docs/evidence/batch2-recovery4/review-reuse.json',
    'docs/evidence/batch2-recovery4/final-results.json',
    'docs/evidence/batch2-recovery5a/independent-evidence-review.md',
]
for p in common:
    evidence(p)

# Exact passed testcase lookup is corroboration only, never requirement coverage.
reports = {}
def cases(path):
    if path not in reports:
        # Only local retained JUnit artifacts are parsed; reject entity/DTD input.
        raw = Path(path).read_bytes()
        assert b'<!DOCTYPE' not in raw.upper() and b'<!ENTITY' not in raw.upper()
        root = ET.fromstring(raw)
        all_cases = list(root.iter('testcase'))
        reports[path] = {'receipt': evidence(path), 'counts': {
            'total': len(all_cases),
            'failed': sum(x.find('failure') is not None for x in all_cases),
            'errors': sum(x.find('error') is not None for x in all_cases),
            'skipped': sum(x.find('skipped') is not None for x in all_cases)},
            'cases': all_cases}
    return reports[path]['cases']

for p in ['docs/evidence/batch2-recovery4/final-backend-core.xml',
          'docs/evidence/batch2-recovery4/final-backend-seams.xml',
          'docs/evidence/batch2-recovery5a/journey-tests.xml',
          'docs/evidence/batch2-recovery5d/poll-correction/frontend.xml']:
    cases(p)

extras = {
 'A11': ['docs/evidence/batch2-recovery5a/exact-replay-proof.json'],
 'A13': ['backend/tests/test_work_events_pg.py'],
 'A15': ['web/test/work-events.test.ts', 'web/test/poll-scope.test.ts'],
 'A21': ['backend/tests/test_b24_runtime_pg.py', 'backend/tests/test_responses_settled_handoff.py'],
 'A22': ['backend/tests/test_responses_recovery.py'],
 'A23': ['backend/tests/test_b24_runtime_pg.py'],
 'A25': ['backend/tests/test_responses_leases.py'],
 'A26': ['backend/tests/test_general_responses_gates.py', 'backend/tests/test_responses_admission.py', 'backend/workagent/run_successors.py'],
 'A27': ['backend/tests/test_b24_runtime_pg.py'],
 'A33': ['backend/tests/test_b24_runtime_pg.py', 'backend/workagent/run_successors.py'],
 'P5': ['backend/tests/test_document_confinement.py', 'backend/tests/test_document_parser.py'],
 'P6': ['docs/GENERAL_PROPOSAL_REVIEW_BATCH_EVALUATION.md', 'docs/evidence/batch2-recovery5b/review.json'],
 'P8': ['docs/GENERAL_PROPOSAL_REVIEW_BATCH_EVALUATION.md'],
}
for key in ['A14', 'A28', 'A35']:
    extras.setdefault(key, []).extend([
      'docs/evidence/batch2-recovery5d/verified-browser-report.json',
      'docs/evidence/batch2-recovery5d/a28-a35-narrow-report.json',
      'docs/evidence/batch2-recovery5d/poll-correction/verified-browser-report.json',
      'docs/evidence/batch2-recovery5c/acceptance-supplement.json'])

result_rows = []
for old in rows:
    key = old['id']
    a = assessments[key]
    status = a.get('status', old['status'])
    assert (status == 'PENDING') == bool(a['gap']) == bool(a['classes'])
    paths = [Path(p) if p.startswith('docs/') else BASE / p for p in old['evidence']]
    paths.extend(old.get('parent_reconciliation_evidence', []))
    paths.extend(extras.get(key, []))
    bound = {str(Path(p).resolve()): evidence(p) for p in paths}
    index = []
    for entry in old.get('supporting_test_index', []):
        path = entry['report']
        hits = [t for t in cases(path) if t.get('name') == entry['name'] and t.get('classname') == entry['class']]
        assert hits, ('unbound test index', key, entry)
        assert all(not list(t.findall('failure')) + list(t.findall('error')) + list(t.findall('skipped')) for t in hits)
        index.append({**entry, 'report_sha256': digest(path), 'passed_matches': len(hits), 'coverage_claim': False})
    levels = ['deterministic_synthetic']
    if key in ['A10', 'P6', 'P8']:
        levels.append('replay')
    if status == 'PENDING':
        levels.append('unavailable')
    result_rows.append({
        'id': key, 'case': old['case'], 'required': old['required'],
        'evidence_required': old['evidence_required'], 'controlling_requirement': requirements[key],
        'status': status, 'prior_status': old['status'], 'assessment': a['assessment'],
        'gap_classes': a['classes'], 'remaining_gap': a['gap'], 'proof_groups': a['group'].split(',') if a['group'] else [],
        'evidence_levels': levels, 'current_live_provider_evidence': 'unavailable/not run',
        'source': ref(CURRENT), 'source_reuse_qualification': 'See source-reuse.json: exact origin manifests/deltas; unaffected evidence reused, changed scope paths covered by 5d. Not a new whole-candidate execution.',
        'evidence': list(bound.values()), 'supporting_test_index_not_coverage': index,
        'parent_qualification_retained': old['scope_or_remaining'],
    })
counts = dict(Counter(r['status'] for r in result_rows))
assert len(result_rows) == len({r['id'] for r in result_rows}) == 43
pending = [r for r in result_rows if r['status'] == 'PENDING']
summary = {
 'generated_at': datetime.now(timezone.utc).isoformat(),
 'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
 'branch': subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip(),
 'source': ref(CURRENT), 'verified_source_files': len(current), 'counts': counts,
 'pending_class_counts_nonexclusive': dict(Counter(c for r in pending for c in r['gap_classes'])),
 'pending_ids': [r['id'] for r in pending],
 'status_changes': [{'id': r['id'], 'before': r['prior_status'], 'after': r['status'], 'why': r['assessment']} for r in result_rows if r['prior_status'] != r['status']],
 'batch2_complete': False, 'publication': 'HOLD', 'new_product_calls': 0, 'new_reservations': 0,
 'new_product_tests': 0, 'new_browser_runs': 0, 'product_source_edits': [],
 'validation': 'Offline hash/schema/XML/unique-row reconciliation only; historical test results retained, not newly executed.',
}
reuse = {
 'current': ref(CURRENT), 'origins': origins,
 'qualification': 'Historical backend/runtime/parser/TUI service files are unchanged except additive api.py session identity/header fence. Contracts changed for ClientSession. Do not call the whole backend/contracts unchanged. New session tests and independently reviewed real scope journeys cover that delta. Browser storage/session/scope/composer changes have 5d reviews/current514 tests and retained real principal/endpoint/revocation journeys. Same-scope upload/control/editor/review semantics are reused with these guards, not rerun here.',
 'reviews_and_gates': [ref(p) for p in common],
}
xml_receipts = {p: {k: v for k, v in d.items() if k != 'cases'} for p, d in reports.items()}
for p, report in xml_receipts.items():
    assert report['counts']['failed'] == report['counts']['errors'] == report['counts']['skipped'] == 0, p

# Hash and bind the exact inspected assertion source/ranges without executing it.
assertions = []
for p in sorted({p for ps in extras.values() for p in ps if p.endswith('.py')}):
    text = Path(p).read_text()
    for node in ast.parse(text).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith('test_'):
            assertions.append({'source': ref(p), 'function': node.name, 'line_start': node.lineno,
                               'line_end': node.end_lineno,
                               'assertions': [ast.get_source_segment(text, n) for n in ast.walk(node) if isinstance(n, ast.Assert)],
                               'warning': 'Source excerpt only; execution attribution must come from a bound XML report. A function name containing restart/crash is not proof of OS process death.'})

md = ['# Full Batch 2 reconciliation after 5d — HOLD', '',
      f"{counts['PASS']} scoped PASS / {counts['PENDING']} PENDING; 43 unique original rows. Source: `{digest(CURRENT)}` (611 files).", '',
      'No new live/model, browser, build, service or product test execution. Evidence is hash-qualified reuse. PASS does not imply live usefulness. Each JSON row contains full SHA256 receipt/source links and verbatim controlling requirement.', '',
      'Classes: **a** existing supporting evidence still needs obligation-specific binding; **b** missing zero-provider mechanism/interaction proof; **c** live/longitudinal or authority blocked. Classes are nonexclusive.', '']
for r in result_rows:
    md += [f"## {r['id']} — {r['status']}: {r['case']}", '',
           '**Required:** ' + r['required'], '**Evidence required:** ' + (r['evidence_required'] or 'Parent requirement above.'),
           '**Reconciled:** ' + r['assessment'],
           '**Remaining:** ' + (r['remaining_gap'] or 'None for the stated scoped obligation.'),
           '**Classes:** ' + (', '.join(r['gap_classes']) or 'closed'),
           '**Levels:** ' + ', '.join(r['evidence_levels']),
           '**Receipts:** ' + '; '.join('`' + e['path'] + '` SHA256 `' + e['sha256'] + '`' for e in r['evidence']), '']
checklist = ['# Every unclosed requirement', '', f'{len(pending)} pending IDs; no removed requirements. See PROOF-SCOPES.md for grouped execution.']
for r in pending:
    checklist += ['', f"- [ ] **{r['id']}** ({'/'.join(r['gap_classes'])}; {', '.join(r['proof_groups'])}): {r['remaining_gap']}"]
outputs = {
 'acceptance-matrix.json': json.dumps({'summary': summary, 'rows': result_rows}, indent=2) + '\n',
 'acceptance-matrix.md': '\n'.join(md) + '\n',
 'summary.json': json.dumps(summary, indent=2) + '\n',
 'source-reuse.json': json.dumps(reuse, indent=2) + '\n',
 'evidence-receipts.json': json.dumps(registry, indent=2) + '\n',
 'preservation-verification.json': json.dumps(preservation, indent=2) + '\n',
 'historical-test-receipts.json': json.dumps(xml_receipts, indent=2) + '\n',
 'assertion-source-index.json': json.dumps(assertions, indent=2) + '\n',
 'MISSING-PROOF-CHECKLIST.md': '\n'.join(checklist) + '\n',
}
import sys
if '--check-only' not in sys.argv[1:]:
    assert all(not (OUT / name).exists() for name in outputs), 'Refusing to overwrite existing reconciliation'
    for name, text in outputs.items():
        with (OUT / name).open('x') as f:
            f.write(text)
else:
    saved = load(OUT / 'acceptance-matrix.json')
    assert saved['rows'] == result_rows
    for key, value in summary.items():
        if key != 'generated_at':
            assert saved['summary'][key] == value, key
    print('CHECK_ONLY: all current rows, source and receipt validations match saved output')
print(json.dumps(summary, indent=2))
print('verified_retained_manifest_files', sum(x['verified_count'] for x in preservation))
print('historical_report_counts', {p: x['counts'] for p, x in xml_receipts.items()})
