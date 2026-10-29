"""Blind offline artifact custody and scoring. No model judge or oracle feedback.

Opaque packet names never contain variants or operational logs. Full original
bytes are copied before assessment. Semantic/manual verdicts remain mandatory;
substring checks alone cannot establish quality. Never import this in product.
"""
import json
from pathlib import Path
import re
import secrets
from harness import canonical, digest, safe_file, write_new, files_manifest


def freeze_packet(artifacts: Path, names: list[str], task: dict, packet: Path, oracle: dict):
    if packet.exists() or not names or len(names) != len(set(names)):
        raise ValueError('fresh_nonempty_packet_required')
    # task is a blinded evaluator-selected task description, not trial metadata.
    if set(task) != {'request', 'required_checks', 'fatal', 'tolerance'}:
        raise ValueError('unblinded_or_incomplete_task')
    for key in ('required_checks', 'fatal'):
        values=task[key]
        if (not isinstance(values,list) or not values or not all(type(x) is str and x for x in values)
                or len(values)!=len(set(values)) or oracle.get(key)!=values):
            raise ValueError('invalid_frozen_check_denominator')
    packet.mkdir(parents=True)
    rows=[]
    for index,name in enumerate(names):
        source=safe_file(artifacts,name)
        suffix=source.suffix.lower()
        if suffix not in {'.md','.txt','.csv','.json','.py','.docx','.pdf','.xlsx'}:
            raise ValueError('unsupported_scoring_artifact')
        destination=f'artifact-{index+1}{suffix}'
        write_new(packet/destination,source.read_bytes())
        rows.append({'name':destination,'sha256':digest(source.read_bytes()),'bytes':source.stat().st_size})
    body={'opaque_id':secrets.token_hex(16),'task':task,'artifacts':rows,
          'oracle_sha256':digest(canonical(oracle))}
    write_new(packet/'packet.json',canonical(body))
    write_new(packet/'freeze.json',canonical(files_manifest(packet)))
    return digest(canonical(body))


def score_packet(packet: Path, oracle: dict, verdict: dict | None):
    freeze=json.loads((packet/'freeze.json').read_text())
    observed=[row for row in files_manifest(packet) if row['path']!='freeze.json']
    if freeze != observed:
        raise ValueError('artifact_changed_after_freeze')
    data=json.loads((packet/'packet.json').read_text())
    if (data['oracle_sha256']!=digest(canonical(oracle))
            or any(data['task'][k]!=oracle.get(k) for k in ('required_checks','fatal'))):
        raise ValueError('oracle_changed_after_freeze')
    texts=[]
    for row in data['artifacts']:
        p=packet/row['name']
        if digest(p.read_bytes())!=row['sha256']:
            raise ValueError('output_hash_mismatch')
        if p.suffix in {'.md','.txt','.csv','.json','.py'}:
            texts.append(p.read_text())
    text='\n'.join(texts)
    mechanical={
      'required_text':all(x in text for x in oracle['artifact_checks']['must_contain']),
      'forbidden_text_absent':all(x not in text for x in oracle['artifact_checks']['must_not_contain'])}
    base={'opaque_id':data['opaque_id'],'packet_sha256':digest((packet/'packet.json').read_bytes()),
          'mechanical':mechanical,'quality':'not_scored','provider_calls':0}
    if verdict is None:
        return base
    required={'reviewer','packet_sha256','checks','fatal','human_seconds','steering_events','setup_seconds',
              'recall_review_seconds','corrections','notes'}
    if set(verdict)!=required or verdict['packet_sha256']!=base['packet_sha256']:
        raise ValueError('invalid_or_unbound_verdict')
    if not verdict['reviewer'] or not isinstance(verdict['notes'],str):
        raise ValueError('reviewer_and_notes_required')
    if set(verdict['checks'])!=set(oracle['required_checks']) or set(verdict['fatal'])!=set(oracle['fatal']):
        raise ValueError('incomplete_check_denominator')
    if not all(type(x) is bool for x in [*verdict['checks'].values(),*verdict['fatal'].values()]):
        raise ValueError('boolean_check_required')
    for name in ['human_seconds','steering_events','setup_seconds','recall_review_seconds','corrections']:
        if type(verdict[name]) not in (int,float) or not 0<=verdict[name]<1e9:
            raise ValueError('invalid_effort_measure')
    fatal=any(verdict['fatal'].values()) or not mechanical['forbidden_text_absent']
    base.update({'quality':'fatal_fail' if fatal else 'meets_task_checks' if all(mechanical.values()) and all(verdict['checks'].values()) else 'task_fail',
                 'verdict':verdict,'judge_scope':'manual verdict plus limited text checks; not statistical superiority'})
    return base


def paired_effort(b1: dict, m1: dict):
    """Descriptive-only active-time arithmetic, NEVER a matched-pair win label.

    Actual pair/rule identity and task-specific action gates belong to the frozen
    live-study adjudication record. This helper deliberately cannot accept a
    post-hoc tolerance or turn faster-with-extra-corrections into acceptance.
    """
    for value in (b1,m1):
        if value.get('quality')!='meets_task_checks':
            return {'comparison':'inconclusive_or_quality_failure'}
    def total(v):
        x=v['verdict']
        return sum(x[k] for k in ('human_seconds','setup_seconds','recall_review_seconds'))
    delta=total(m1)-total(b1)
    return {'comparison':'descriptive_only_not_matched_or_adjudicated',
            'effort_delta_seconds':delta,
            'corrections_delta':m1['verdict']['corrections']-b1['verdict']['corrections'],
            'steering_delta':m1['verdict']['steering_events']-b1['verdict']['steering_events'],
            'claim_scope':'not a win/loss; no validated pair/rule or measured baseline supplied'}
