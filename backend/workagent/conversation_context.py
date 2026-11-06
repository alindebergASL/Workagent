"""Deterministic request projection; never mutates the durable conversation.

Current human input is lossless. Older human text/corrections have priority over
assistant prose and duplicated artifact bodies. Omission is explicit, not an
invented model summary or a claim to remember material outside the window.
"""
from .errors import DomainError


def bound_context(context, run_id, max_bytes):
    from .service import canonical
    messages = context['messages']
    from .documents import project_message_documents
    for message in messages:
        project_message_documents(message)
    current = next(m for m in messages if m['run_id'] == run_id and m['author_kind'] in ('human', 'system'))
    # Exclude any later publication from this immutable run's input projection.
    history = [m for m in messages if m['sequence'] < current['sequence']]
    # A system continuation must carry the last human steering verbatim too.
    required = [current]
    if current['author_kind'] == 'system':
        human = next((m for m in reversed(history) if m['author_kind'] == 'human'), None)
        if human is not None:
            required.insert(0, human)
            history = [m for m in history if m['id'] != human['id']]
    context['messages'] = required
    context['history_window'] = {
        'policy': 'human-first-window-v1',
        'through_sequence': current['sequence'],
        'omitted_messages': len(history),
        'prior_attachment_bodies_omitted': True,
        'notice': 'Durable history is unchanged. Older input may be outside this window; do not invent it. '
                  'Current human intent and corrections override earlier assistant text. '
                  'Ask for relevant missing detail rather than assuming an omitted instruction.',
    }
    # Reserve fixed metadata overhead; refuse oversized *current* input intact.
    def size():
        return len(canonical(context).encode())
    if size() > max_bytes:
        raise DomainError('budget_exhausted')
    selected = []
    # All available space goes first to recent verbatim human instructions, not
    # old tool payloads. No text truncation, paraphrase, or semantic classification.
    for kind in ('human', 'system', 'assistant'):
        for original in reversed(history):
            if original['author_kind'] != kind:
                continue
            message = {k: v for k, v in original.items() if k not in ('result', 'model_receipt', 'operation')}
            message['attachments'] = [{k: v for k, v in a.items() if k != 'content'}
                                      for a in original.get('attachments', [])]
            candidate = sorted([*selected, message, *required], key=lambda m: m['sequence'])
            context['messages'] = candidate
            context['history_window']['omitted_messages'] = len(history) - len(selected) - 1
            if size() > max_bytes:
                # Do not skip a large recent correction in favor of older intent.
                context['messages'] = sorted([*selected, *required], key=lambda m: m['sequence'])
                context['history_window']['omitted_messages'] = len(history) - len(selected)
                break
            selected.append(message)
    return context
