from workagent.tui.safe_text import conversation_text


def detail(chunks=None):
    return {'messages':[{'id':'m1','author_kind':'human','text':'Retain file','attachments':[{'ref':'a1','sha256':'hash','filename':'retained.txt','byte_length':57000}]}],
            'attachment_context':[{'message_id':'m1','ref':'a1','sha256':'hash','filename':'retained.txt','body_omitted':True,'omission_reason':'size_limit','chunks':chunks or []}]}


def test_actual_omission_not_size_guess():
    d=detail()
    assert 'omitted from bounded context' in conversation_text(d)
    d['attachment_context']=[]
    assert 'omitted' not in conversation_text(d)


def test_range_attribution_not_full_recovery():
    d=detail([{'phase':'step1','offset':56000,'next_offset':57000,'chunk_sha256':'chunk'}])
    text=conversation_text(d)
    assert 'Original bytes read: 56000–57000 (end exclusive)' in text
    assert 'omitted from bounded context' in text
    assert 'fully recovered' not in text


def test_foreign_receipt_not_displayed_and_control_literal():
    d=detail();d['attachment_context'][0]['sha256']='other'
    assert 'omitted' not in conversation_text(d)
    d=detail();d['messages'][0]['attachments'][0]['filename']='x\x1b]0;danger\x07.txt'
    assert '\x1b' not in conversation_text(d)
