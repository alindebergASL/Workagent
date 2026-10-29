"""Display untrusted text literally, without Rich markup, ANSI or bidi controls."""
import unicodedata


def literal(value):
    text=str(value)
    return ''.join(c if c in '\n\t' or unicodedata.category(c) not in ('Cc','Cf','Cs')
                   else '\\u%04x'%ord(c) for c in text)


def conversation_text(detail, *, page=0):
    messages=detail.get('messages',[])
    end=max(0,len(messages)-page*40);start=max(0,end-40)
    lines=['Messages '+str(start+1 if end else 0)+'–'+str(end)+' of '+str(len(messages))+
           ' · Earlier / Later pages' if messages else 'Start a conversation.']
    for message in messages[start:end]:
        lines.append(literal(message.get('author_kind','message'))+': '+literal(message.get('text','')))
        for attachment in message.get('attachments',[]):
            lines.append('  Attached: '+literal(attachment.get('filename',''))+' · '+str(attachment.get('byte_length','?'))+' bytes')
            state=next((item for item in detail.get('attachment_context',[])
                        if item.get('message_id')==message.get('id')
                        and item.get('ref')==attachment.get('ref')
                        and item.get('sha256')==attachment.get('sha256')),None)
            if state:
                if state.get('body_omitted'):
                    lines.append('  Original retained; body omitted from bounded context.')
                chunks=state.get('chunks',[])
                if chunks:
                    lines.append('  Original bytes read: '+', '.join(
                        str(chunk['offset'])+'–'+str(chunk['next_offset']) for chunk in chunks)+
                        ' (end exclusive). Only these ranges are confirmed read.')
        result=message.get('result') or {}
        for item in result.get('results',[]):
            if item.get('kind')=='text' and item.get('text')!=message.get('text'):
                lines.append(literal(item.get('text','')))
            elif item.get('kind')!='text':
                from .presentation import prose
                lines.append(prose(item))
    text='\n\n'.join(lines)
    if len(text)>120000:text=text[:120000]+'\n[Display limit reached; full retained response is in Details.]'
    return text
