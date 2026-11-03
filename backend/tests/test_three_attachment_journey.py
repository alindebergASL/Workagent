"""Three-attachment end-to-end journey (P6 acceptance).

The B3.5g process-restart resume shape: two corpus files plus one harness
resume attachment must pass admission AND persist through the full service
readback (ConversationMessage), exercising models.py:602.
"""
from pathlib import Path
import tempfile
from test_domain import context  # noqa: F401
from test_conversations import conversation,post
from test_general_responses import activate,Provider,worker,attach
from workagent.message_models import AttachmentInput

def _resume(): return AttachmentInput(filename='resume.md',mime_type='text/plain',content='# Resume\nContinue the availability planning where the handoff left off.\n')
def _goals(): return AttachmentInput(filename='goals.csv',mime_type='text/csv',content='goal,target\nlaunch,2026-11-05\n')
def _issues(): return AttachmentInput(filename='issues.json',mime_type='text/plain',content='{"issues": [{"id": 1}]}\n')

def test_three_attachment_message_admits_and_persists_full_readback(context):
    s,p,ws,_,_=context
    cv=conversation(context);activate(context,[cv])
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        w=worker(context,Provider(),Path(td))
        initial=post(context,cv,'Plan around the attached availability, goals and resume note.',
                     attachments=[attach(),_goals(),_resume()])
        w.work(p,ws,initial.run.id)
        detail=s.get_conversation(p,ws,cv.id)  # crashes with ValidationError pre-fix (models.py:602)
        human=[m for m in detail.messages if m.author_kind=='human']
        m=human[-1]
        assert len(m.attachments)==3, f'expected 3 persisted attachments, got {len(m.attachments)}'

def test_fourth_attachment_rejected_at_admission(context):
    from workagent.models import PostMessage
    import pytest
    cv=conversation(context)
    with pytest.raises(Exception):
        post(context,cv,'Too many.',attachments=[attach(),_goals(),_issues(),_resume()])
