"""P5: text-only terminal replies materialize as editable worker artifacts.

Real disposable PostgreSQL (test_domain context); no providers and no live
calls: the controlled profile uses ControlledTransport, the responses profile
uses the synthetic MockTransport fixture. Mirrors the b35e finding: a text-only
episode-1 reply used to leave dependent corrections with no editable target
(missing_named_model_artifact, 6/6 trajectories).
"""
from hashlib import sha256

import pytest

from test_domain import context, cmd
from test_conversations import conversation, post
from workagent.db import Database
from workagent.errors import DomainError
from workagent.general_worker import GeneralWorker, ControlledTransport
from workagent.models import ExactTarget, HumanSave, new_id
from workagent.product_models import FileBody
from workagent.reply_artifact import REPLY_FILENAME, REPLY_TITLE
from workagent.service import Service

REPLY=('A verifiable editorial answer: the deadlines are unverified, HumanOwner is '
       'preserved, and the requested plan is feasible in dependency order.')


def sole_artifact(s, p, ws, cv):
    detail=s.get_conversation(p,ws,cv.id)
    assert len(detail.artifact_ids)==1
    return s.get_artifact(p,ws,detail.artifact_ids[0])


def test_controlled_text_reply_materializes_exact_editable_artifact(context):
    # (1) text-only controlled reply -> one editable artifact with exact bytes
    s,p,ws,_,_=context
    cv=conversation(context)
    queued=post(context,cv,'Answer in text only, no artifact.')
    transport=ControlledTransport([dict(results=[dict(kind='text',text=REPLY)])])
    assert GeneralWorker(s,transport=transport).work(p,ws,queued.run.id).state=='ready'
    art=sole_artifact(s,p,ws,cv)
    body=art.current_revision.body
    assert isinstance(body,FileBody) and body.kind=='file'
    assert body.filename==REPLY_FILENAME and body.mime_type=='text/plain'
    assert body.title==REPLY_TITLE != 'Working file'
    assert body.content==REPLY and body.content_sha256==sha256(REPLY.encode()).hexdigest()
    assert art.conversation_id==cv.id
    assert art.current_revision.author_kind=='worker'
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) n FROM audit WHERE workspace_id=%s AND object_id=%s "
            "AND operation='materialize_reply_artifact'",(ws,queued.run.id)).fetchone()['n']==1
        assert c.execute('SELECT producer_run_id FROM revisions WHERE workspace_id=%s AND id=%s',
            (ws,art.current_revision_id)).fetchone()['producer_run_id']==queued.run.id


def test_controlled_replay_and_restart_do_not_duplicate(context):
    # (3) settled-turn replay and a fresh Service both leave exactly one revision
    s,p,ws,_,_=context
    cv=conversation(context)
    queued=post(context,cv,'Answer in text only, no artifact.')
    transport=ControlledTransport([dict(results=[dict(kind='text',text=REPLY)])])
    worker=GeneralWorker(s,transport=transport)
    assert worker.work(p,ws,queued.run.id).state=='ready'
    assert worker.work(p,ws,queued.run.id).state=='ready'
    assert transport.calls==1
    restarted=Service(Database(s.db.dsn))
    assert restarted.get_run(p,ws,queued.run.id).state=='ready'
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM artifacts WHERE workspace_id=%s',(ws,)).fetchone()['n']==1
        assert c.execute('SELECT count(*) n FROM revisions WHERE workspace_id=%s',(ws,)).fetchone()['n']==1


def test_responses_text_reply_materializes_and_survives_human_edit(context,tmp_path):
    # (1)+(4) synthetic-provider text-only reply, then a human correction on top
    from test_general_alpha_runtime import launch
    from test_adaptive_execution import finish_safe_visits
    from test_general_alpha_runtime import worker as alpha_worker
    s,p,ws,_,_=context
    text='Answer delivered in text only; nothing was saved as a product.'
    cv,grant,q,fake,w=launch(context,tmp_path,[dict(kind='reply',text=text)])
    assert finish_safe_visits(context,w,q.run.id).state=='ready'
    art=sole_artifact(s,p,ws,cv)
    body=art.current_revision.body
    assert body.content==text and body.filename==REPLY_FILENAME
    assert art.current_revision.author_kind=='worker'
    # (4) human edit preserved: correction builds on the materialized artifact
    corrected_content='Human corrected opening.\n'+body.content
    corrected=body.model_copy(update={'content':corrected_content,
        'content_sha256':sha256(corrected_content.encode()).hexdigest()})
    saved=s.human_save(p,ws,art.id,cmd(HumanSave,
        expected_current_revision_id=art.current_revision_id,body=corrected))
    current=s.get_artifact(p,ws,art.id)
    assert current.current_revision_id==saved.current_revision_id
    assert current.current_revision.body.content==corrected.content
    assert current.current_revision.author_kind=='human'
    assert current.current_revision.parent_revision_id==art.current_revision_id


def test_run_with_saved_worker_artifact_does_not_materialize(context,tmp_path):
    # (2) CSV run publishes its table+file artifacts; no reply.txt ever appears
    from test_general_responses import activate, Provider, worker, attach
    s,p,ws,_,_=context
    cv=conversation(context)
    grant=activate(context,[cv]); fake=Provider()
    queued=post(context,cv,'Reconcile this CSV, preserve values and notes.',
                attachments=[attach()])
    assert worker(context,fake,tmp_path).work(p,ws,queued.run.id).state=='ready'
    detail=s.get_conversation(p,ws,cv.id)
    # initial product = editable table body + exact download file
    assert len(detail.artifact_ids)==2
    for aid in detail.artifact_ids:
        body=s.get_artifact(p,ws,aid).current_revision.body
        assert not (isinstance(body,FileBody) and body.filename==REPLY_FILENAME
                    and body.title==REPLY_TITLE)
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) n FROM audit WHERE workspace_id=%s "
            "AND operation='materialize_reply_artifact'",(ws,)).fetchone()['n']==0
        assert c.execute('SELECT count(*) n FROM artifacts WHERE workspace_id=%s',(ws,)).fetchone()['n']==2


def test_transition_selection_finds_materialized_artifact(context,tmp_path):
    # (5) the ordinary reviewed-transition consumer can now select the artifact
    import importlib, sys
    from pathlib import Path
    root=Path(__file__).resolve().parents[2]
    sys.path.insert(0,str(root/'evaluation'))
    try:
        packets=importlib.import_module('post_freeze_packets')
    finally:
        sys.path.remove(str(root/'evaluation'))
    s,p,ws,_,_=context
    cv=conversation(context)
    queued=post(context,cv,'Answer in text only, no artifact.')
    transport=ControlledTransport([dict(results=[dict(kind='text',text=REPLY)])])
    assert GeneralWorker(s,transport=transport).work(p,ws,queued.run.id).state=='ready'
    art=sole_artifact(s,p,ws,cv)
    # exact-filename download basis (primary_artifact: exact requested filename)
    download=s.download_product(p,ws,art.id)
    assert download.filename==REPLY_FILENAME and download.mime_type=='text/plain'
    assert download.content==REPLY
    # sole editable document basis: it is the conversation's only artifact
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.artifact_ids==[art.id]
    # review gate: no proposals exist, so no receipts are owed; the exact
    # current target is returned for the transition's ExactTarget.
    target=packets.require_reviewed_transition(s,p,ws,art.id,{})
    assert target==dict(artifact_id=art.id,revision_id=art.current_revision_id,
                        body_hash=art.current_revision.body_hash)
    # collection credits the run as producer of the materialized revision
    packet=packets.collect_packet(s,p,ws,queued.run.id)
    assert packet['run_produced_revisions']==[dict(artifact_id=art.id,
        revision_id=art.current_revision_id,body_hash=art.current_revision.body_hash,
        producer_run_id=queued.run.id)]
    # the transition's actual admission step: dependent post with exact target
    # (scoped-grant admission, as the transition consumer performs it)
    from test_general_alpha_runtime import activate
    activate(context,s.get_conversation(p,ws,cv.id).conversation)
    dependent=post(context,s.get_conversation(p,ws,cv.id).conversation,
                   'Continue from the reviewed saved reply.',
                   target=ExactTarget(artifact_id=art.id,revision_id=art.current_revision_id,
                                      body_hash=art.current_revision.body_hash))
    assert dependent.run.state=='queued' and dependent.run.id!=queued.run.id
    assert dependent.message.target.artifact_id==art.id
