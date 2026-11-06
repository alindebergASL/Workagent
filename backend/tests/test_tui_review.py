"""Readable products and exact consent without live service calls."""
import copy
from workagent.tui.presentation import body_text, comparison_text, execution_text, revision_label
from workagent.tui.safe_text import conversation_text


def document(text):return {'title':'Plan','blocks':[{'block_id':'b','kind':'protected_note','text':text}]}


def test_full_current_base_candidate_and_server_sample_count():
    current={'current_revision_id':'human','current_revision':{'id':'human','author_kind':'human','body':document('HUMAN CURRENT')}}
    base={'body':document('BASE OLD')}
    candidate={'id':'p','base_revision_id':'base','body':document('PROPOSED'),'status':'pending',
               'review':{'is_latest':False,'removed_content_count':42,'removed_content':[{'path':'/blocks/b','before':'sample'}]}}
    text=comparison_text(current,base,candidate)
    for fragment in ('HUMAN CURRENT','BASE OLD','PROPOSED','42 total','1 displayed','Earlier candidate','STALE'):
        assert fragment in text


def test_table_document_and_source_are_readable_and_inert():
    table={'kind':'structured_table','title':'Budget','fields':[{'key':'cost','label':'Cost','unit':'USD'}],
           'rows':[{'row_id':'r','cells':[{'field_key':'cost','value':'12.50'}]}],'notes':['Retain exact note\r\n雪']}
    assert 'Cost: 12.50 USD' in body_text(table)
    assert 'Retain exact note\\u000d\n雪' in body_text(table)
    text=body_text({'kind':'custom_view','title':'Tool','fallback':'Readable fallback','source':{'js':'[red]\x1b]8;;http://evil\x07\u202e'}})
    assert 'Readable fallback' in text and '\x1b' not in text and '\u202e' not in text
    assert '[red]' in text


def test_history_human_current_and_bounded_transcript():
    assert revision_label({'id':'r','revision_number':4,'author_kind':'human'},'r').startswith('Current saved')
    assert revision_label({'id':'old','revision_number':3,'author_kind':'worker'},'r').startswith('Earlier')
    detail={'messages':[{'text':str(i),'author_kind':'human'} for i in range(2000)]}
    latest=conversation_text(detail);earlier=conversation_text(detail,page=1)
    assert '1961–2000 of 2000' in latest and '1921–1960 of 2000' in earlier
    assert 'human: 1999' in latest and 'human: 1999' not in earlier
    assert len(conversation_text({'messages':[{'text':'x'*12000}]*40}))<121000


def test_status_uses_execution_not_queued_receipt():
    detail={'runs':[{'id':'run','state':'queued','observed_at':'now'}]}
    execution={'state':'unavailable','checked_at':'timestamp','runs':[{'run_id':'run','state':'blocked','next_action':'Review budget'}]}
    text=execution_text(execution,detail,{'responsibilities':[{'lifecycle':{'state':'waiting_event','next_action':{'instruction':'Recheck'},'next_check_in_at':'tomorrow'}}]})
    for value in ('unavailable','blocked','Review budget','timestamp','unknown','waiting_event','Recheck','tomorrow'):assert value in text
