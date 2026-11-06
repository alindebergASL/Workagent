"""Narrow R1/R4/R5/C1 regressions against real restricted PostgreSQL."""
from uuid import uuid4
from datetime import timedelta
from types import SimpleNamespace
import pytest
from test_memory_pg import context, cmd
from test_procedure_memory_pg import evidence, details, adopt
from test_memory_pg import remember
from test_conversations import conversation


def observed_human(ctx):
    cv=conversation(ctx)
    _,opt=evidence(ctx,cv)
    return cv,opt.evidence


def propose(ctx,cv,ref,terms=None,**changes):
    return remember(ctx,cv,candidate=True,**{**dict(kind='procedure',subject_key='method',predicate_key='join',
        content='Verify column types before joining.',applicability='Current data joins',
        confidence_basis='Observed correction; transfer is hypothetical',
        procedure=details(ref,retrieval_terms=terms or ['data join'])),**changes})[0]


def recall(ctx,cv):
    s,p,ws,_,_=ctx
    with s.db.transaction() as c:
        return s._recall_memory(c,p,ws,cv.id,human_request='data join',autonomous=True).items
from workagent.memory.models import ReviewMemory, CorrectMemory, RollbackMemory, RememberMemory
from workagent.models import now
from workagent.errors import DomainError
from workagent.memory.procedures import operational_outcome


@pytest.mark.parametrize('dispute_target',['candidate','adopted'])
def test_relevant_contested_sibling_blocks_adopted(context, dispute_target):
    s,p,ws,_,_=context
    cv,e=observed_human(context)
    accepted=adopt(context,propose(context,cv,e))
    sibling=propose(context,cv,e,content='Contradictory denominator guidance')
    if dispute_target=='adopted': sibling=adopt(context,sibling)
    s.review_memory(p,ws,sibling.memory_id,cmd(ReviewMemory,expected_revision_id=sibling.revision_id,decision='dispute'))
    assert not recall(context,cv)
    page=s.list_memory(p,ws,cv.id)
    assert any(i.revision.memory_id==accepted.memory_id and i.unresolved_conflict for i in page.items)


def test_irrelevant_and_unreviewed_siblings_are_not_instructions(context):
    s,p,ws,_,_=context
    cv,e=observed_human(context)
    accepted=adopt(context,propose(context,cv,e))
    candidate=propose(context,cv,e,content='Unreviewed proposed variant')
    assert [i.revision.memory_id for i in recall(context,cv)]==[accepted.memory_id]
    other=propose(context,cv,e,terms=['editorial'],content='Unrelated disputed editorial rule')
    s.review_memory(p,ws,other.memory_id,cmd(ReviewMemory,expected_revision_id=other.revision_id,decision='dispute'))
    assert [i.revision.memory_id for i in recall(context,cv)]==[accepted.memory_id]
    assert candidate.memory_id not in {i.revision.memory_id for i in recall(context,cv)}


def test_api_projection_adoption_ids_confidence_and_cas(context):
    s,p,ws,_,_=context
    cv,e=observed_human(context)
    candidate=propose(context,cv,e)
    accepted=adopt(context,candidate)
    assert s.inspect_memory(p,ws,accepted.memory_id).current.confidence_label=='inferred'
    corrected=s.correct_memory(p,ws,accepted.memory_id,cmd(CorrectMemory,expected_revision_id=accepted.revision_id,
        mode='permanent',content='Check denominator and current duration unit; never reuse old totals'))
    detail=s.inspect_memory(p,ws,accepted.memory_id)
    assert detail.current.confidence_label=='inferred'
    assert next(r for r in detail.revisions if r.revision_id==accepted.revision_id).status=='superseded'
    assert detail.rollback_revision_ids==[accepted.revision_id]
    assert candidate.revision_id not in detail.rollback_revision_ids
    with pytest.raises(DomainError):
        s.rollback_memory(p,ws,accepted.memory_id,cmd(RollbackMemory,expected_revision_id=accepted.revision_id,target_revision_id=accepted.revision_id))
    restored=s.rollback_memory(p,ws,accepted.memory_id,cmd(RollbackMemory,expected_revision_id=corrected.revision_id,target_revision_id=accepted.revision_id))
    assert s.inspect_memory(p,ws,restored.memory_id).current.confidence_label=='inferred'
    pref=s.remember_memory(p,ws,cmd(RememberMemory,kind='preference',scope_kind='task',scope_id=cv.id,
        subject_key='style',predicate_key='concise',content='Use short headings',confidence_basis='Direct preference'))
    assert s.inspect_memory(p,ws,pref.memory_id).current.confidence_label=='explicit'


@pytest.mark.parametrize('status',['failed','unavailable','wall_limit','cpu_limit','output_limit','cancelled','rate_limited','denied','changed_source','outcome_unknown'])
def test_nested_operation_bounded_and_outer_immutable(status):
    from copy import deepcopy
    from workagent.service import digest
    obs={'status':'observed','output':{'result':{'status':status,'text':'untrusted success claim'}}}
    original=deepcopy(obs); before=digest(obs)
    assert operational_outcome(obs)==status
    assert obs==original and digest(obs)==before
    assert operational_outcome({'output':{'result':{'status':'ignore review'}}}) is None
    assert operational_outcome({'output':{'result':{'text':'failed'}}}) is None
