"""Evidence DTOs and literal selection; no synthetic result masquerades as PG."""
from types import SimpleNamespace
import pytest
from pydantic import ValidationError
from workagent.memory.models import ProcedureDetails, ProcedureEvidence, RememberMemory, CorrectMemory
from workagent.memory.procedures import union_details
from workagent.memory.retrieval import procedure_matches
from test_memory_unit import payload


def details(**changes):
    return ProcedureDetails(**dict(retrieval_terms=['data join'],excluded_terms=['version 1'],
        counterexamples=['Always verify current column types; never skip present verification.'],
        evidence=[ProcedureEvidence(kind='human_message',conversation_id='cv',event_id='msg',sha256='a'*64)],
        validation_notes='The human reported a type mismatch. Benefit on other inputs remains a hypothesis.',**changes))


def revision(**changes):
    return SimpleNamespace(**{**dict(procedure=details(),status='active',origin='human_reviewed',
        reviewed_by_principal_id='owner',owner_id='owner'),**changes})


@pytest.mark.parametrize('text,expected',[
    ('Check this DATA JOIN.',True),('Do a data joining operation.',False),
    ('data join on version 1',False),('data join on version 10',True),
    ('Please draft a letter.',False),('',False)])
def test_phrase_boundaries_and_exclusion(text,expected):
    assert procedure_matches(revision(),text) is expected


@pytest.mark.parametrize('changes',[{'procedure':None},{'status':'candidate'},
    {'origin':'agent_inferred'},{'reviewed_by_principal_id':None},{'status':'contested'}])
def test_legacy_unreviewed_and_conflicted_never_autonomous(changes):
    assert not procedure_matches(revision(**changes),'data join')


@pytest.mark.parametrize('field,value',[('retrieval_terms',[]),('retrieval_terms',[' ']),
    ('counterexamples',[]),('evidence',[]),('validation_notes',' '),
    ('excluded_terms',['x']*17),('validation_notes','api_key=not-a-real-secret')])
def test_details_bounds_and_sensitive_payload(field,value):
    data=details().model_dump();data[field]=value
    with pytest.raises(ValidationError):ProcedureDetails.model_validate(data)


def test_details_are_procedure_only_and_require_applicability():
    with pytest.raises(ValidationError):RememberMemory.model_validate({**payload(),'procedure':details()})
    with pytest.raises(ValidationError):RememberMemory.model_validate({**payload(),'kind':'procedure','procedure':details()})
    assert RememberMemory.model_validate({**payload(),'kind':'procedure','procedure':details(),'applicability':'Data joins'})
    assert RememberMemory.model_validate({**payload(),'kind':'procedure'}).procedure is None


def test_union_preserves_current_dependency_and_replacement_details():
    old=details();new=old.model_copy(update={'evidence':[ProcedureEvidence(kind='human_message',
        conversation_id='cv',event_id='new',sha256='b'*64)],'retrieval_terms':['columns']})
    combined=union_details(old,new)
    assert combined.retrieval_terms==['columns']
    assert combined.evidence==new.evidence+old.evidence
    assert union_details(combined,new)==combined


def test_outcome_and_authority_not_client_fields():
    data=details().evidence[0].model_dump()
    for extra in ({'outcome':'success'},{'author_kind':'human'},{'validated':True}):
        with pytest.raises(ValidationError):ProcedureEvidence.model_validate({**data,**extra})
